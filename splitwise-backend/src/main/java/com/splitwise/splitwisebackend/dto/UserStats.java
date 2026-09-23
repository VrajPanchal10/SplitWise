package com.splitwise.splitwisebackend.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class UserStats {
    private Long totalBills;
    private Long groupsCount;
    private Long friendsCount;
}