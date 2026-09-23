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

            // Normalize the image: re-encode as clean JPEG to fix malformed headers
            // (e.g., "JFIF APP0 must be first marker after SOI" from mobile cameras)
            // The TwelveMonkeys ImageIO plugin (on classpath) provides a more lenient
            // JPEG decoder. We also re-encode to produce a standard-compliant JPEG.
            File normalizedFile = normalizeImage(tempFile);
            if (normalizedFile != null) {
                tempFile = normalizedFile;
            }

            // Preprocess the image for OCR:
            // 1. Upscale if the width is below MIN_OCR_WIDTH (fixes "Image too
            // small to scale" / "Line cannot be recognized")
            // 2. Convert to grayscale (Tesseract performs far better on
            // grayscale/binarized images than raw color photos)
            // 3. Apply subtle contrast enhancement to make text pop
            // Returns a BufferedImage; orientation is handled by multi-angle OCR.
            BufferedImage preprocessed = preprocessForOcr(tempFile);
            if (preprocessed == null) {
                log.warn("Preprocessing returned null, reading raw normalized file instead");
                preprocessed = ImageIO.read(tempFile);
            }

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

            // Run OCR on the preprocessed grayscale image directly (single pass).
            // Multi-rotation adds complexity without benefit for now; we focus
            // on getting one clean, correctly-oriented grayscale image to
            // Tesseract first.
            String result = tesseract.doOCR(preprocessed);
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

            // Read the image using ImageIO (TwelveMonkeys plugin provides lenient JPEG
            // decoding)
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
     * Preprocesses an image for OCR:
     * <ol>
     * <li><b>Upscale</b> - if the image width is below {@link #MIN_OCR_WIDTH},
     * scales it up (bicubic interpolation) to {@link #TARGET_OCR_WIDTH} px
     * wide, maintaining aspect ratio. This directly addresses Tesseract's
     * "Image too small to scale" / "Line cannot be recognized" warnings.</li>
     * <li><b>Grayscale</b> - converts to TYPE_BYTE_GRAY. Tesseract recognizes
     * text much more reliably on grayscale than raw color photos.</li>
     * <li><b>Contrast enhancement</b> - applies a RescaleOp that slightly
     * brightens and increases contrast so faint/dark thermal-print text
     * stands out from the paper background.</li>
     * </ol>
     *
     * The preprocessed result is saved to a new temp file and returned.
     * If processing fails for any reason, returns null so the caller falls
     * back to the input as-is.
     */
    private BufferedImage preprocessForOcr(File inputFile) {
        try {
            log.info("Preprocessing image for OCR: {}", inputFile.getName());

            BufferedImage image = ImageIO.read(inputFile);
            if (image == null) {
                log.warn("ImageIO.read returned null for {}, skipping preprocessing", inputFile.getName());
                return null;
            }

            int originalWidth = image.getWidth();
            int originalHeight = image.getHeight();
            log.info("Original image dimensions: {}x{}", originalWidth, originalHeight);

            // ---- Step 1: Upscale if below minimum resolution ----
            BufferedImage workingImage = image;
            if (originalWidth < MIN_OCR_WIDTH) {
                double scale = (double) TARGET_OCR_WIDTH / originalWidth;
                int newWidth = TARGET_OCR_WIDTH;
                int newHeight = (int) Math.round(originalHeight * scale);
                // Guard against absurd aspect ratios producing a degenerate height
                if (newHeight < 1)
                    newHeight = 1;

                log.info("Upscaling image from {}x{} to {}x{} (scale={})",
                        originalWidth, originalHeight, newWidth, newHeight, String.format("%.2f", scale));

                workingImage = new BufferedImage(newWidth, newHeight, BufferedImage.TYPE_INT_RGB);
                Graphics2D g2d = workingImage.createGraphics();
                try {
                    g2d.setRenderingHint(RenderingHints.KEY_INTERPOLATION,
                            RenderingHints.VALUE_INTERPOLATION_BICUBIC);
                    g2d.setRenderingHint(RenderingHints.KEY_RENDERING,
                            RenderingHints.VALUE_RENDER_QUALITY);
                    g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING,
                            RenderingHints.VALUE_ANTIALIAS_ON);
                    g2d.drawImage(image, 0, 0, newWidth, newHeight, null);
                } finally {
                    g2d.dispose();
                }
            } else {
                log.info("Image width {} is already >= {}, skipping upscale", originalWidth, MIN_OCR_WIDTH);
            }

            // NOTE: Hard-rotating landscape photos here produced EMPTY OCR on
            // real scans because EXIF orientation/crop direction varies. We
            // intentionally do NOT rotate here; multi-angle OCR in
            // runOcrOnAllRotations() tries all four rotations instead.

            // ---- Step 2: Convert to grayscale ----
            BufferedImage grayImage = new BufferedImage(
                    workingImage.getWidth(), workingImage.getHeight(), BufferedImage.TYPE_BYTE_GRAY);
            Graphics2D grayG2d = grayImage.createGraphics();
            try {
                grayG2d.drawImage(workingImage, 0, 0, null);
            } finally {
                grayG2d.dispose();
            }

            // ---- Step 3: Mild contrast stretch (NOT hard thresholding) ----
            // A gentle linear rescale that brightens blacks slightly and
            // stretches the dynamic range so faint text becomes more distinct.
            // We deliberately do NOT binarize here: a naive fixed black/white
            // threshold destroys text on unevenly-lit or slightly-blurry phone
            // photos)Skip. Tesseract has its own internal adaptive binarization
            // and works best on clean grayscale input.
            float scaleFactor = 1.1f;
            float offset = 8f;
            RescaleOp rescale = new RescaleOp(scaleFactor, offset, null);
            BufferedImage enhancedImage = rescale.filter(grayImage, null);

            log.info("Preprocessed image ready (grayscale): {}x{}",
                    enhancedImage.getWidth(), enhancedImage.getHeight());
            return enhancedImage;
        } catch (IOException e) {
            log.warn("Failed to preprocess image {}, falling back to original: {}", inputFile.getName(),
                    e.getMessage());
            return null;
        }
    }

    /**
     * Runs Tesseract on the image in 0°, 90°, 180°, and 270° rotations and
     * returns the text from the rotation that contains the most English words.
     * This eliminates all orientation guesswork (EXIF, crop direction,
     * upside-down photos) without requiring osd.traineddata.
     */
    private String runOcrOnAllRotations(Tesseract tesseract, BufferedImage src) throws TesseractException {
        String bestText = "";
        int bestScore = -1;

        for (int angle : ROTATION_ANGLES) {
            BufferedImage rotated = (angle == 0) ? src : rotate(src, angle);

            String text = tesseract.doOCR(rotated);
            int score = textQualityScore(text);
            log.info("OCR @{}° -> score={}, length={}\n{}",
                    angle, score, text == null ? 0 : text.length(), text);

            if (text != null && score > bestScore) {
                bestScore = score;
                bestText = text;
            }
        }

        log.info("Chose rotation with score {} (text length {})",
                bestScore, bestText == null ? 0 : bestText.length());
        return bestText == null ? "" : bestText;
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