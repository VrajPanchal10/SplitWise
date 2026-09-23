package com.splitwise.splitwisebackend.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.List;

@Data
public class CreateGroupRequest {
    @NotBlank(message = "Group name is required")
    private String name;
    private List<String> memberIds;
}