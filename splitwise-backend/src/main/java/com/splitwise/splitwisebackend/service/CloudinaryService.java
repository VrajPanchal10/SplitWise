package com.splitwise.splitwisebackend.service;

import com.cloudinary.Cloudinary;
import com.cloudinary.utils.ObjectUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;

@Service
public class CloudinaryService {

    private final Cloudinary cloudinary;

    @Value("${cloudinary.folder:SplitWise}")
    private String folder;

    public CloudinaryService(Cloudinary cloudinary) {
        this.cloudinary = cloudinary;
    }

    public String uploadImage(MultipartFile file) throws IOException {
        try {
            Map<?, ?> uploadResult = cloudinary.uploader().upload(
                file.getBytes(),
                ObjectUtils.asMap(
                    "folder", folder,
                    "resource_type", "auto"
                )
            );
            
            // Return the secure_url (HTTPS URL) from the response
            return (String) uploadResult.get("secure_url");
        } catch (Exception e) {
            throw new IOException("Failed to upload image to Cloudinary: " + e.getMessage(), e);
        }
    }
}