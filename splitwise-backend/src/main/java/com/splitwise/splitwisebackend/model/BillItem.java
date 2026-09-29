package com.splitwise.splitwisebackend.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class BillItem {
    private String name;
    private Double price;
    private List<String> sharedByUserIds;
    /** Optional custom/unequal shares: userId -> exact share amount. */
    private java.util.Map<String, Double> customShares;
}