package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.exception.ApiException;
import lombok.extern.slf4j.Slf4j;
import net.sourceforge.tess4j.ITessAPI;
import net.sourceforge.tess4j.Tesseract;
import net.sourceforge.tess4j.TesseractException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.awt.image.RescaleOp;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@Slf4j
public class OcrService {

    /**
     * Minimum width (in pixels) we scale images up to before sending to
     * Tesseract. Receipts/photos below this are too low-resolution for
     * accurate OCR ("Image too small to scale", garbled characters).
     */
    private static final int MIN_OCR_WIDTH = 1500;

    /**
     * Target width when upscaling. Using a value comfortably above the minimum
     * gives Tesseract plenty of pixels for accurate line/text recognition.
     */
    private static final int TARGET_OCR_WIDTH = 2000;

    /**
     * Phone photos of a horizontal receipt are often captured in landscape
     * (width > height) and EXIF orientation is frequently lost/misapplied on
     * upload. Rather than guessing the rotation, we run OCR on all four
     * orientations and keep the text with the highest English-word score.
     */
    private static final int[] ROTATION_ANGLES = { 0, 90, 180, 270 };

    @Value("${tesseract.datapath:}")
    private String tesseractDatapath;

    public String extractTextFromImage(MultipartFile imageFile) {
        File tempFile = null;
        try {
            // Save the uploaded MultipartFile to a temporary file
            tempFile = File.createTempFile("ocr_upload_", "_" + imageFile.getOriginalFilename());
            imageFile.transferTo(tempFile);

            // Read the image using ImageIO (TwelveMonkeys on classpath provides lenient decoding)
            BufferedImage rawImage = null;
            try {
                rawImage = ImageIO.read(tempFile);
            } catch (Exception e) {
                log.warn("Direct ImageIO.read failed on {}, falling back to normalization: {}",
                        tempFile.getName(), e.getMessage());
            }

            // Fallback normalization only if direct read failed
            if (rawImage == null) {
                File normalizedFile = normalizeImage(tempFile);
                if (normalizedFile != null) {
                    tempFile = normalizedFile;
                    rawImage = ImageIO.read(tempFile);
                }
            }

            if (rawImage == null) {
                throw new ApiException("Could not decode receipt image format", HttpStatus.BAD_REQUEST);
            }

            // Preprocess image in-memory for OCR:
            // 1. Upscale if below MIN_OCR_WIDTH
            // 2. Convert to grayscale
            // 3. Dynamic contrast enhancement (histogram stretch)
            BufferedImage preprocessed = preprocessImage(rawImage);

            // Initialize Tesseract with the tessdata path and proper engine config
            Tesseract tesseract = new Tesseract();
            if (tesseractDatapath != null && !tesseractDatapath.isEmpty()) {
                tesseract.setDatapath(tesseractDatapath);
            }
            // English language data (the eng.traineddata in the tessdata folder)
            tesseract.setLanguage("eng");
            // NOTE: Do NOT set user_defined_dpi here. On images already >= 1500px
            // wide it causes Tesseract to compute a huge physical size and
            // downscale the whole image to ~2px text ("Image too small to scale
            // 2x36" error). Let Tesseract use its own adaptive scaling instead.
            //
            // PSM 6 (SINGLE_BLOCK) is the best fit for a receipt: a single
            // narrow column of text. Explicitly setting it avoids the layout
            // mis-detection that PSM_AUTO can cause on photos.
            tesseract.setPageSegMode(ITessAPI.TessPageSegMode.PSM_SINGLE_BLOCK);
            // LSTM-only engine (faster, more accurate for printed receipts)
            tesseract.setOcrEngineMode(ITessAPI.TessOcrEngineMode.OEM_LSTM_ONLY);
            // Preserve interword column spacing so item names and prices do not collide
            tesseract.setTessVariable("preserve_interword_spaces", "1");

            // Adaptive orientation: run 0° first. If clear text is found (score >= 15),
            // return immediately. Otherwise fallback to testing 90°, 180°, 270°.
            String result = runAdaptiveOcr(tesseract, preprocessed);
            log.info("Raw OCR text:\n{}", result);
            return result.trim();

        } catch (TesseractException e) {
            log.error("Tesseract OCR failed", e);
            throw new ApiException("OCR processing failed: " + e.getMessage(), HttpStatus.INTERNAL_SERVER_ERROR);
        } catch (IOException e) {
            log.error("Failed to process image file", e);
            throw new ApiException("Failed to process image file: " + e.getMessage(), HttpStatus.INTERNAL_SERVER_ERROR);
        } finally {
            // Clean up the temporary file
            if (tempFile != null && tempFile.exists()) {
                tempFile.delete();
            }
        }
    }

    /**
     * Normalizes an image file by re-encoding it as a clean JPEG.
     * This fixes malformed JPEG headers (e.g., "JFIF APP0 must be first marker
     * after SOI")
     * that are common with images from mobile camera/gallery apps.
     *
     * Uses the TwelveMonkeys ImageIO plugin (auto-registered on classpath) for
     * more lenient JPEG decoding. If re-encoding fails for any reason, returns null
     * so the original file is used as a fallback.
     */
    private File normalizeImage(File inputFile) {
        try {
            log.info("Normalizing image: {}", inputFile.getName());

            BufferedImage image = ImageIO.read(inputFile);
            if (image == null) {
                log.warn("ImageIO.read returned null for {}, skipping normalization", inputFile.getName());
                return null;
            }

            // Re-encode as clean JPEG
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            ImageIO.write(image, "jpg", baos);
            byte[] cleanBytes = baos.toByteArray();

            // Write the clean JPEG to a new temp file
            File cleanFile = File.createTempFile("ocr_normalized_", ".jpg");
            java.nio.file.Files.write(cleanFile.toPath(), cleanBytes);

            log.info("Image normalized successfully: {} -> {} ({} bytes)",
                    inputFile.getName(), cleanFile.getName(), cleanBytes.length);

            // Delete the original temp file
            inputFile.delete();

            return cleanFile;
        } catch (IOException e) {
            log.warn("Failed to normalize image {}, falling back to original: {}", inputFile.getName(), e.getMessage());
            return null;
        }
    }

    /**
     * Preprocesses an in-memory BufferedImage for OCR:
     * 1. Upscale if below MIN_OCR_WIDTH
     * 2. Convert to grayscale
     * 3. Dynamic contrast stretch (histogram percentiles)
     */
    public BufferedImage preprocessImage(BufferedImage image) {
        int originalWidth = image.getWidth();
        int originalHeight = image.getHeight();
        log.info("Original image dimensions: {}x{}", originalWidth, originalHeight);

        // ---- Step 1: Upscale if below minimum resolution ----
        BufferedImage workingImage = image;
        if (originalWidth < MIN_OCR_WIDTH) {
            double scale = (double) TARGET_OCR_WIDTH / originalWidth;
            int newWidth = TARGET_OCR_WIDTH;
            int newHeight = (int) Math.round(originalHeight * scale);
            if (newHeight < 1) newHeight = 1;

            log.info("Upscaling image from {}x{} to {}x{} (scale={})",
                    originalWidth, originalHeight, newWidth, newHeight, String.format("%.2f", scale));

            workingImage = new BufferedImage(newWidth, newHeight, BufferedImage.TYPE_INT_RGB);
            Graphics2D g2d = workingImage.createGraphics();
            try {
                g2d.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
                g2d.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
                g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                g2d.drawImage(image, 0, 0, newWidth, newHeight, null);
            } finally {
                g2d.dispose();
            }
        }

        // ---- Step 2: Convert to grayscale ----
        BufferedImage grayImage = new BufferedImage(
                workingImage.getWidth(), workingImage.getHeight(), BufferedImage.TYPE_BYTE_GRAY);
        Graphics2D grayG2d = grayImage.createGraphics();
        try {
            grayG2d.drawImage(workingImage, 0, 0, null);
        } finally {
            grayG2d.dispose();
        }

        // ---- Step 3: Dynamic contrast enhancement ----
        BufferedImage enhancedImage = enhanceContrast(grayImage);
        log.info("Preprocessed image ready: {}x{}", enhancedImage.getWidth(), enhancedImage.getHeight());
        return enhancedImage;
    }

    private BufferedImage preprocessForOcr(File inputFile) {
        try {
            BufferedImage image = ImageIO.read(inputFile);
            if (image == null) return null;
            return preprocessImage(image);
        } catch (IOException e) {
            log.warn("Failed to preprocess image {}, falling back to original: {}", inputFile.getName(), e.getMessage());
            return null;
        }
    }

    /**
     * Stretches the dynamic range of a grayscale image using histogram percentiles
     * (2% low, 98% high), making faint receipts much more readable for OCR.
     */
    private BufferedImage enhanceContrast(BufferedImage gray) {
        try {
            int width = gray.getWidth();
            int height = gray.getHeight();
            int totalPixels = width * height;

            int[] hist = new int[256];
            for (int y = 0; y < height; y++) {
                for (int x = 0; x < width; x++) {
                    int pixel = gray.getRaster().getSample(x, y, 0);
                    hist[pixel & 0xFF]++;
                }
            }

            int lowCut = (int) (totalPixels * 0.02);
            int highCut = (int) (totalPixels * 0.98);

            int low = 0;
            int count = 0;
            for (int i = 0; i < 256; i++) {
                count += hist[i];
                if (count >= lowCut) {
                    low = i;
                    break;
                }
            }

            count = 0;
            int high = 255;
            for (int i = 255; i >= 0; i--) {
                count += hist[i];
                if (count >= (totalPixels - highCut)) {
                    high = i;
                    break;
                }
            }

            // If range is already broad or invalid, fall back to mild rescale
            if (high <= low || (high - low) > 230) {
                RescaleOp rescale = new RescaleOp(1.1f, 8f, null);
                return rescale.filter(gray, null);
            }

            byte[] lut = new byte[256];
            for (int i = 0; i < 256; i++) {
                if (i <= low) {
                    lut[i] = 0;
                } else if (i >= high) {
                    lut[i] = (byte) 255;
                } else {
                    lut[i] = (byte) Math.min(255, Math.max(0, (i - low) * 255 / (high - low)));
                }
            }

            java.awt.image.ByteLookupTable lookupTable = new java.awt.image.ByteLookupTable(0, lut);
            java.awt.image.LookupOp op = new java.awt.image.LookupOp(lookupTable, null);
            return op.filter(gray, null);
        } catch (Exception e) {
            log.warn("Dynamic contrast stretch failed, falling back to RescaleOp: {}", e.getMessage());
            RescaleOp rescale = new RescaleOp(1.1f, 8f, null);
            return rescale.filter(gray, null);
        }
    }

    /**
     * Runs Tesseract with smart orientation detection:
     * Tries standard 0° first. If clear text is detected (score >= 15), returns immediately.
     * Only if the image appears sideways or upside-down (score < 15), tries 90°, 180°, and 270°.
     */
    private String runAdaptiveOcr(Tesseract tesseract, BufferedImage src) throws TesseractException {
        // Fast path: try 0 degrees
        String text0 = tesseract.doOCR(src);
        int score0 = textQualityScore(text0);
        log.info("OCR @0° -> score={}, length={}", score0, text0 == null ? 0 : text0.length());

        if (score0 >= 15) {
            return text0 == null ? "" : text0;
        }

        log.info("0° OCR quality score {} < 15, attempting rotations (90°, 180°, 270°)", score0);
        String bestText = text0 == null ? "" : text0;
        int bestScore = score0;

        int[] otherAngles = { 90, 180, 270 };
        for (int angle : otherAngles) {
            BufferedImage rotated = rotate(src, angle);
            String text = tesseract.doOCR(rotated);
            int score = textQualityScore(text);
            log.info("OCR @{}° -> score={}, length={}", angle, score, text == null ? 0 : text.length());

            if (text != null && score > bestScore) {
                bestScore = score;
                bestText = text;
            }
        }

        log.info("Selected rotation with best score {}", bestScore);
        return bestText == null ? "" : bestText;
    }

    /**
     * Runs Tesseract on the image in 0°, 90°, 180°, and 270° rotations and
     * returns the text from the rotation that contains the most English words.
     */
    private String runOcrOnAllRotations(Tesseract tesseract, BufferedImage src) throws TesseractException {
        return runAdaptiveOcr(tesseract, src);
    }

    /**
     * Simple heuristic: the more 2+ letter English tokens and the more
     * money-sized numbers we find, the more likely Tesseract read the text the
     * right way up.
     */
    private int textQualityScore(String text) {
        if (text == null || text.isEmpty())
            return 0;
        int score = 0;

        Matcher wordMatcher = Pattern.compile("[A-Za-z]{2,}").matcher(text);
        while (wordMatcher.find())
            score += 3;

        Matcher numberMatcher = Pattern.compile("\\d{2,}(?:[.,]\\d{1,2})?").matcher(text);
        while (numberMatcher.find())
            score += 2;

        String lower = text.toLowerCase();
        if (lower.contains("total") || lower.contains("amount"))
            score += 5;
        if (lower.contains("tax") || lower.contains("gst"))
            score += 2;
        if (text.contains("."))
            score += 1;

        return score;
    }

    /**
     * Rotates a BufferedImage clockwise by a multiple of 90 degrees.
     */
    private BufferedImage rotate(BufferedImage src, int degrees) {
        int w = src.getWidth();
        int h = src.getHeight();

        int newW = (degrees == 90 || degrees == 270) ? h : w;
        int newH = (degrees == 90 || degrees == 270) ? w : h;

        BufferedImage rotated = new BufferedImage(newW, newH, src.getType());
        Graphics2D g2d = rotated.createGraphics();
        try {
            g2d.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
                    RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            g2d.setRenderingHint(RenderingHints.KEY_RENDERING,
                    RenderingHints.VALUE_RENDER_QUALITY);

            switch (degrees) {
                case 90 -> {
                    g2d.translate(newW, 0);
                    g2d.rotate(Math.toRadians(90));
                }
                case 180 -> {
                    g2d.translate(w, h);
                    g2d.rotate(Math.toRadians(180));
                }
                case 270 -> {
                    g2d.translate(0, newH);
                    g2d.rotate(Math.toRadians(270));
                }
                default -> {
                    // 0 degrees - no rotation, copy as-is
                }
            }
            g2d.drawImage(src, 0, 0, null);
        } finally {
            g2d.dispose();
        }
        return rotated;
    }
}