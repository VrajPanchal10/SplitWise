package com.splitwise.splitwisebackend.controller;

import com.splitwise.splitwisebackend.dto.ReceiptParseResult;
import com.splitwise.splitwisebackend.service.CloudinaryService;
import com.splitwise.splitwisebackend.service.OcrService;
import com.splitwise.splitwisebackend.service.ReceiptParserService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@RestController
@RequestMapping("/api/ocr")
@RequiredArgsConstructor
@Slf4j
public class OcrController {

    private final OcrService ocrService;
    private final ReceiptParserService receiptParserService;
    private final CloudinaryService cloudinaryService;

    /**
     * Scans a receipt image and extracts a suggested title, total amount, and
     * line items, and uploads the image to Cloudinary for permanent storage.
     *
     * @param image the uploaded image file (form-data, key name "image")
     * @return JSON response with rawText (for debugging), suggestedTitle,
     *         totalAmount, confidence, items (parsed BillItemRequest list), and receiptUrl
     */
    @PostMapping("/scan")
    public ResponseEntity<Map<String, Object>> scanReceipt(@RequestParam("image") MultipartFile image) {
        // Upload receipt image to Cloudinary (SplitWise folder)
        String receiptUrl = null;
        try {
            receiptUrl = cloudinaryService.uploadImage(image);
            log.info("Bill receipt uploaded to Cloudinary: {}", receiptUrl);
        } catch (Exception e) {
            log.warn("Could not upload receipt to Cloudinary, proceeding with OCR: {}", e.getMessage());
        }

        // Extract raw text from image using OCR
        String rawText = ocrService.extractTextFromImage(image);

        // Parse the raw text to extract title, total, and structured items
        ReceiptParseResult parseResult = receiptParserService.parseReceiptText(rawText);

        // Return raw text plus the structured parse result and receiptUrl
        Map<String, Object> response = new java.util.HashMap<>();
        response.put("rawText", rawText);
        response.put("items", parseResult.getItems());
        response.put("suggestedTitle", parseResult.getSuggestedTitle());
        response.put("totalAmount", parseResult.getTotalAmount());
        response.put("confidence", parseResult.getConfidence());
        response.put("receiptUrl", receiptUrl);

        return ResponseEntity.ok(response);
    }
}