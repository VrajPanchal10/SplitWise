package com.splitwise.splitwisebackend.controller;

import com.splitwise.splitwisebackend.service.CloudinaryService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/upload")
@Slf4j
public class UploadController {

    private final CloudinaryService cloudinaryService;

    public UploadController(CloudinaryService cloudinaryService) {
        this.cloudinaryService = cloudinaryService;
    }

    @PostMapping("/image")
    public ResponseEntity<Map<String, String>> uploadImage(@RequestParam("image") MultipartFile file) {
        try {
            if (file == null || file.isEmpty()) {
                log.warn("Upload image requested with empty or missing file");
                return ResponseEntity.badRequest().build();
            }

            String imageUrl = cloudinaryService.uploadImage(file);
            log.info("Image successfully uploaded to Cloudinary: {}", imageUrl);
            
            Map<String, String> response = new HashMap<>();
            response.put("url", imageUrl);
            
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("Cloudinary upload failed: {}", e.getMessage(), e);
            return ResponseEntity.internalServerError().build();
        }
    }
}