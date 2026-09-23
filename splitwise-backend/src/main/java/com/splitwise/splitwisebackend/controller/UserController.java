package com.splitwise.splitwisebackend.controller;

import com.splitwise.splitwisebackend.dto.UserResponse;
import com.splitwise.splitwisebackend.dto.UserStats;
import com.splitwise.splitwisebackend.model.FriendBalance;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.UserRepository;
import com.splitwise.splitwisebackend.service.ActivityService;
import com.splitwise.splitwisebackend.service.UserService;
import lombok.extern.slf4j.Slf4j;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
@Slf4j
public class UserController {

    private final UserService userService;
    private final UserRepository userRepository;
    private final ActivityService activityService;

    private String getCurrentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        String email = authentication.getName();
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found"));
        return user.getId();
    }

    @GetMapping("/me")
    public ResponseEntity<UserResponse> getCurrentUserProfile() {
        String userId = getCurrentUserId();
        User user = userService.getUserById(userId);
        UserResponse response = new UserResponse(
                user.getId(),
                user.getFullName(),
                user.getEmail(),
                user.getProfilePictureUrl(),
                user.getPaymentQrUrl(),
                user.getCreatedAt() != null ? user.getCreatedAt().toString() : null
        );
        return ResponseEntity.ok(response);
    }

    @GetMapping("/{id}")
    public ResponseEntity<UserResponse> getUserById(@PathVariable String id) {
        User user = userService.getUserById(id);
        UserResponse response = new UserResponse(
                user.getId(),
                user.getFullName(),
                user.getEmail(),
                user.getProfilePictureUrl(),
                user.getPaymentQrUrl(),
                user.getCreatedAt() != null ? user.getCreatedAt().toString() : null
        );
        return ResponseEntity.ok(response);
    }

    @PutMapping("/me")
    public ResponseEntity<UserResponse> updateCurrentUserProfile(@Valid @RequestBody UpdateProfileRequest request) {
        String userId = getCurrentUserId();
        User updatedUser = userService.updateProfile(userId, request.getFullName());
        UserResponse response = new UserResponse(
                updatedUser.getId(),
                updatedUser.getFullName(),
                updatedUser.getEmail(),
                updatedUser.getProfilePictureUrl(),
                updatedUser.getPaymentQrUrl(),
                updatedUser.getCreatedAt() != null ? updatedUser.getCreatedAt().toString() : null
        );
        return ResponseEntity.ok(response);
    }

    @PutMapping("/me/profile-picture")
    public ResponseEntity<UserResponse> updateProfilePicture(@RequestBody ProfilePictureRequest request) {
        String userId = getCurrentUserId();
        User user = userService.getUserById(userId);
        user.setProfilePictureUrl(request.getProfilePictureUrl());
        User updatedUser = userRepository.save(user);

        // Activity feed: record the profile photo change
        activityService.logActivity(
                userId,
                "PROFILE_PHOTO_CHANGED",
                "You updated your profile photo",
                null,
                null,
                userId);
        log.info("Activity logged: You updated your profile photo");
        UserResponse response = new UserResponse(
                updatedUser.getId(),
                updatedUser.getFullName(),
                updatedUser.getEmail(),
                updatedUser.getProfilePictureUrl(),
                updatedUser.getPaymentQrUrl(),
                updatedUser.getCreatedAt() != null ? updatedUser.getCreatedAt().toString() : null
        );
        return ResponseEntity.ok(response);
    }

    @PutMapping("/me/payment-qr")
    public ResponseEntity<UserResponse> updatePaymentQr(@RequestBody PaymentQrRequest request) {
        String userId = getCurrentUserId();
        User user = userService.getUserById(userId);
        user.setPaymentQrUrl(request.getPaymentQrUrl());
        User updatedUser = userRepository.save(user);
        UserResponse response = new UserResponse(
                updatedUser.getId(),
                updatedUser.getFullName(),
                updatedUser.getEmail(),
                updatedUser.getProfilePictureUrl(),
                updatedUser.getPaymentQrUrl(),
                updatedUser.getCreatedAt() != null ? updatedUser.getCreatedAt().toString() : null
        );
        return ResponseEntity.ok(response);
    }

    @GetMapping("/me/stats")
    public ResponseEntity<UserStats> getCurrentUserStats() {
        String userId = getCurrentUserId();
        UserStats stats = userService.getUserStats(userId);
        return ResponseEntity.ok(stats);
    }

    @GetMapping("/search")
    public ResponseEntity<UserResponse> searchUserByEmail(@RequestParam String email) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found with email: " + email));
        UserResponse response = new UserResponse(
                user.getId(),
                user.getFullName(),
                user.getEmail(),
                user.getProfilePictureUrl(),
                user.getPaymentQrUrl(),
                user.getCreatedAt() != null ? user.getCreatedAt().toString() : null
        );
        return ResponseEntity.ok(response);
    }

    @GetMapping("/me/friends")
    public ResponseEntity<List<UserResponse>> getMyFriends() {
        String userId = getCurrentUserId();
        List<String> friendIds = userService.getFriendIds(userId);
        List<User> friends = userRepository.findAllById(friendIds);
        List<UserResponse> response = friends.stream()
                .map(user -> new UserResponse(
                        user.getId(),
                        user.getFullName(),
                        user.getEmail(),
                        user.getProfilePictureUrl(),
                        user.getPaymentQrUrl(),
                        user.getCreatedAt() != null ? user.getCreatedAt().toString() : null
                ))
                .collect(Collectors.toList());
        return ResponseEntity.ok(response);
    }

    @GetMapping("/me/friend-balances")
    public ResponseEntity<List<FriendBalance>> getMyFriendBalances() {
        String userId = getCurrentUserId();
        List<FriendBalance> balances = userService.getAllFriendBalances(userId);
        return ResponseEntity.ok(balances);
    }

    // Inner class for request body
    public static class UpdateProfileRequest {
        private String fullName;

        public String getFullName() {
            return fullName;
        }

        public void setFullName(String fullName) {
            this.fullName = fullName;
        }
    }

    // Inner class for profile picture request
    public static class ProfilePictureRequest {
        private String profilePictureUrl;

        public String getProfilePictureUrl() {
            return profilePictureUrl;
        }

        public void setProfilePictureUrl(String profilePictureUrl) {
            this.profilePictureUrl = profilePictureUrl;
        }
    }

    // Inner class for payment QR request
    public static class PaymentQrRequest {
        private String paymentQrUrl;

        public String getPaymentQrUrl() {
            return paymentQrUrl;
        }

        public void setPaymentQrUrl(String paymentQrUrl) {
            this.paymentQrUrl = paymentQrUrl;
        }
    }
}
