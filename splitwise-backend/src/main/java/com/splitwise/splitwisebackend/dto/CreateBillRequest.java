package com.splitwise.splitwisebackend.dto;

import lombok.Data;

import java.util.List;

@Data
public class CreateBillRequest {
    private String title;
    private Double totalAmount;
    private String groupId;
    private String paidBy;
    private List<BillItemRequest> items;
    private String receiptUrl;
}