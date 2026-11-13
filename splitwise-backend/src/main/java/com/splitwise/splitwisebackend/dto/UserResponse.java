package com.splitwise.splitwisebackend.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserResponse {
    private String id;
    private String fullName;
    private String email;
    private String profilePictureUrl;
    private String paymentQrUrl;
    private String createdAt;
    private String defaultCurrency;

    public UserResponse(String id, String fullName, String email, String profilePictureUrl, String paymentQrUrl, String createdAt) {
        this(id, fullName, email, profilePictureUrl, paymentQrUrl, createdAt, "INR");
    }
}

