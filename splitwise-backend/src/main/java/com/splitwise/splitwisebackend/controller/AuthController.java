package com.splitwise.splitwisebackend.controller;

import com.splitwise.splitwisebackend.dto.AuthResponse;
import com.splitwise.splitwisebackend.dto.LoginRequest;
import com.splitwise.splitwisebackend.dto.SignupRequest;
import com.splitwise.splitwisebackend.service.AuthService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);
    private final AuthService authService;

    @PostMapping("/signup")
    public ResponseEntity<AuthResponse> signup(@Valid @RequestBody SignupRequest request) {
        log.info("[AUTH] Received signup request for: {}", maskEmail(request.getEmail()));
        AuthResponse response = authService.signup(request);
        log.info("[AUTH] Signup successful for: {}", maskEmail(request.getEmail()));
        return ResponseEntity.ok(response);
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        log.info("[AUTH] Received login request for: {}", maskEmail(request.getEmail()));
        AuthResponse response = authService.login(request);
        log.info("[AUTH] Login successful for: {}", maskEmail(request.getEmail()));
        return ResponseEntity.ok(response);
    }

    private String maskEmail(String email) {
        if (email == null || !email.contains("@")) {
            return "unknown";
        }
        int atIndex = email.indexOf("@");
        if (atIndex <= 1) {
            return "*@" + email.substring(atIndex + 1);
        }
        return email.charAt(0) + "***" + email.substring(atIndex - 1);
    }
}
