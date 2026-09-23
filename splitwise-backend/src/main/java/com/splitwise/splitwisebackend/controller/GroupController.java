package com.splitwise.splitwisebackend.controller;

import com.splitwise.splitwisebackend.dto.CreateGroupRequest;
import com.splitwise.splitwisebackend.dto.UserResponse;
import com.splitwise.splitwisebackend.model.Group;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.UserRepository;
import com.splitwise.splitwisebackend.service.GroupService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/groups")
@RequiredArgsConstructor
public class GroupController {

    private final GroupService groupService;
    private final UserRepository userRepository;

    private String getCurrentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        String email = authentication.getName();
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found"));
        return user.getId();
    }

    @PostMapping
    public ResponseEntity<Group> createGroup(@Valid @RequestBody CreateGroupRequest request) {
        String userId = getCurrentUserId();
        Group group = groupService.createGroup(request.getName(), request.getMemberIds(), userId);
        return ResponseEntity.ok(group);
    }

    @GetMapping
    public ResponseEntity<List<Group>> getGroups() {
        String userId = getCurrentUserId();
        List<Group> groups = groupService.getGroupsForUser(userId);
        return ResponseEntity.ok(groups);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Group> getGroup(@PathVariable String id) {
        Group group = groupService.getGroupById(id);
        return ResponseEntity.ok(group);
    }

    @PostMapping("/{id}/members")
    public ResponseEntity<Group> addMember(@PathVariable String id, @RequestBody Map<String, String> body) {
        String userId = body.get("userId");
        Group group = groupService.addMemberToGroup(id, userId);
        return ResponseEntity.ok(group);
    }

    @DeleteMapping("/{id}/members/{userId}")
    public ResponseEntity<Group> removeMember(@PathVariable String id, @PathVariable String userId) {
        Group group = groupService.removeMemberFromGroup(id, userId);
        return ResponseEntity.ok(group);
    }

    @GetMapping("/{id}/members")
    public ResponseEntity<List<UserResponse>> getGroupMembers(@PathVariable String id) {
        Group group = groupService.getGroupById(id);
        List<String> memberIds = group.getMemberIds();
        
        List<User> members = userRepository.findAllById(memberIds);
        
        List<UserResponse> response = members.stream()
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

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteGroup(@PathVariable String id) {
        String userId = getCurrentUserId();
        groupService.deleteGroup(id, userId);
        return ResponseEntity.noContent().build();
    }
}
