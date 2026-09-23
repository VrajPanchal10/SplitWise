package com.splitwise.splitwisebackend.controller;

import com.splitwise.splitwisebackend.model.Activity;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.UserRepository;
import com.splitwise.splitwisebackend.service.ActivityService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/activities")
@RequiredArgsConstructor
public class ActivityController {

    private static final int MAX_FEED_SIZE = 50;

    private final ActivityService activityService;
    private final UserRepository userRepository;

    /**
     * Returns the current user's activity feed, newest first, limited to the
     * most recent 50 entries.
     */
    @GetMapping("/me")
    public ResponseEntity<List<Activity>> getMyActivities() {
        String userId = getCurrentUserId();
        List<Activity> activities = activityService.getRecentActivities(userId, MAX_FEED_SIZE);
        return ResponseEntity.ok(activities);
    }

    private String getCurrentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        String email = authentication.getName();
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found"));
        return user.getId();
    }
}