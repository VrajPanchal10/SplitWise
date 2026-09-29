package com.splitwise.splitwisebackend.dto;

import lombok.Data;

import java.util.List;

@Data
public class BillItemRequest {
    private String name;
    private Double price;
    private List<String> sharedByUserIds;
    /** Quantity extracted from OCR (optional, null if not detected). */
    private Double quantity;
    /** Unit price extracted from OCR (optional, null if not detected). */
    private Double unitPrice;
    /** Optional custom/unequal shares: userId -> exact share amount. */
    private java.util.Map<String, Double> customShares;
}