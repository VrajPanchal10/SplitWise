package com.splitwise.splitwisebackend.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class Settlement {
    private String fromUserId;
    private String toUserId;
    private Double amount;
}