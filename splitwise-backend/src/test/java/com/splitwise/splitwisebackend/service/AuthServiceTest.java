package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.dto.AuthResponse;
import com.splitwise.splitwisebackend.dto.LoginRequest;
import com.splitwise.splitwisebackend.dto.SignupRequest;
import com.splitwise.splitwisebackend.exception.ApiException;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.UserRepository;
import com.splitwise.splitwisebackend.security.JwtUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

public class AuthServiceTest {

    private UserRepository userRepository;
    private JwtUtil jwtUtil;
    private BCryptPasswordEncoder passwordEncoder;
    private AuthService authService;

    @BeforeEach
    void setUp() {
        userRepository = Mockito.mock(UserRepository.class);
        jwtUtil = Mockito.mock(JwtUtil.class);
        passwordEncoder = Mockito.mock(BCryptPasswordEncoder.class);
        authService = new AuthService(userRepository, jwtUtil, passwordEncoder);
    }

    @Test
    @DisplayName("login: returns AuthResponse on valid credentials")
    void login_Success() {
        LoginRequest request = new LoginRequest();
        request.setEmail("user@example.com");
        request.setPassword("correctPassword");

        User existingUser = new User();
        existingUser.setId("user123");
        existingUser.setFullName("Test User");
        existingUser.setEmail("user@example.com");
        existingUser.setPassword("encodedHash");

        when(userRepository.findByEmailIgnoreCase("user@example.com")).thenReturn(Optional.of(existingUser));
        when(passwordEncoder.matches("correctPassword", "encodedHash")).thenReturn(true);
        when(jwtUtil.generateToken("user@example.com")).thenReturn("mock-jwt-token");

        AuthResponse response = authService.login(request);

        assertNotNull(response);
        assertEquals("mock-jwt-token", response.getToken());
        assertEquals("user123", response.getUserId());
        assertEquals("Test User", response.getFullName());
        assertEquals("user@example.com", response.getEmail());
    }

    @Test
    @DisplayName("login: throws UNAUTHORIZED on invalid password")
    void login_InvalidPassword() {
        LoginRequest request = new LoginRequest();
        request.setEmail("user@example.com");
        request.setPassword("wrongPassword");

        User existingUser = new User();
        existingUser.setId("user123");
        existingUser.setEmail("user@example.com");
        existingUser.setPassword("encodedHash");

        when(userRepository.findByEmailIgnoreCase("user@example.com")).thenReturn(Optional.of(existingUser));
        when(passwordEncoder.matches("wrongPassword", "encodedHash")).thenReturn(false);

        ApiException ex = assertThrows(ApiException.class, () -> authService.login(request));
        assertEquals(HttpStatus.UNAUTHORIZED, ex.getStatus());
        assertEquals("Invalid credentials", ex.getMessage());
    }

    @Test
    @DisplayName("login: throws UNAUTHORIZED when user is not found")
    void login_UserNotFound() {
        LoginRequest request = new LoginRequest();
        request.setEmail("nonexistent@example.com");
        request.setPassword("password");

        when(userRepository.findByEmailIgnoreCase("nonexistent@example.com")).thenReturn(Optional.empty());
        when(userRepository.findByEmail("nonexistent@example.com")).thenReturn(Optional.empty());

        ApiException ex = assertThrows(ApiException.class, () -> authService.login(request));
        assertEquals(HttpStatus.UNAUTHORIZED, ex.getStatus());
        assertEquals("Invalid credentials", ex.getMessage());
    }

    @Test
    @DisplayName("login: handles case-insensitive email matching")
    void login_CaseInsensitiveEmail() {
        LoginRequest request = new LoginRequest();
        request.setEmail("User@Example.COM ");
        request.setPassword("correctPassword");

        User existingUser = new User();
        existingUser.setId("user123");
        existingUser.setEmail("user@example.com");
        existingUser.setPassword("encodedHash");

        when(userRepository.findByEmailIgnoreCase("User@Example.COM")).thenReturn(Optional.of(existingUser));
        when(passwordEncoder.matches("correctPassword", "encodedHash")).thenReturn(true);
        when(jwtUtil.generateToken("user@example.com")).thenReturn("mock-jwt-token");

        AuthResponse response = authService.login(request);

        assertNotNull(response);
        assertEquals("user123", response.getUserId());
    }

    @Test
    @DisplayName("signup: succeeds for new email and saves user")
    void signup_Success() {
        SignupRequest request = new SignupRequest();
        request.setFullName("New User");
        request.setEmail("newuser@example.com");
        request.setPassword("secret123");

        when(userRepository.findByEmailIgnoreCase("newuser@example.com")).thenReturn(Optional.empty());
        when(passwordEncoder.encode("secret123")).thenReturn("encodedPassword");

        User saved = new User();
        saved.setId("new123");
        saved.setFullName("New User");
        saved.setEmail("newuser@example.com");
        when(userRepository.save(any(User.class))).thenReturn(saved);
        when(jwtUtil.generateToken("newuser@example.com")).thenReturn("new-jwt-token");

        AuthResponse response = authService.signup(request);

        assertNotNull(response);
        assertEquals("new-jwt-token", response.getToken());
        assertEquals("new123", response.getUserId());
        assertEquals("New User", response.getFullName());
        verify(userRepository, times(1)).save(any(User.class));
    }

    @Test
    @DisplayName("signup: throws CONFLICT when email already exists")
    void signup_DuplicateEmail() {
        SignupRequest request = new SignupRequest();
        request.setFullName("Duplicate User");
        request.setEmail("existing@example.com");
        request.setPassword("password123");

        when(userRepository.findByEmailIgnoreCase("existing@example.com")).thenReturn(Optional.of(new User()));

        ApiException ex = assertThrows(ApiException.class, () -> authService.signup(request));
        assertEquals(HttpStatus.CONFLICT, ex.getStatus());
        assertEquals("Email already exists", ex.getMessage());
        verify(userRepository, never()).save(any(User.class));
    }
}

