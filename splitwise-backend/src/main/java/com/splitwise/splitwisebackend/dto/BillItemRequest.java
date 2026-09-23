package com.splitwise.splitwisebackend.dto;

import lombok.Data;

import java.util.List;

@Data
public class BillItemRequest {
    private String name;
    private Double price;
    private List<String> sharedByUserIds;
}