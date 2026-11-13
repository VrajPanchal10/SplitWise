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
    /** Original currency code (e.g., INR, USD, EUR). Defaults to INR if null/empty. */
    private String currency;
    /** Base target currency for conversion. Defaults to group currency or INR. */
    private String baseCurrency;
    /** Optional user-specified exchange rate. If null, automatically looked up. */
    private Double exchangeRate;
    /** Expense category (e.g., Food, Travel, Transport). Defaults to "Other" if null/empty. */
    private String category;
}