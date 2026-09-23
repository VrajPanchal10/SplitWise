package com.splitwise.splitwisebackend.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class AuthResponse {
    private String token;
    private String userId;
    private String fullName;
    private String email;
    private String profilePictureUrl;
    private String paymentQrUrl;
}
