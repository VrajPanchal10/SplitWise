package com.splitwise.splitwisebackend.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "bills")
public class Bill {
    @Id
    private String id;
    private String title;
    private Double totalAmount;
    private String groupId;
    private String paidBy;
    private List<BillItem> items;
    private String receiptUrl;
    /** Original currency ISO code (e.g., INR, USD, EUR). Defaults to INR for backwards compatibility. */
    private String currency = "INR";
    /** Target base currency for group/balance calculations. */
    private String baseCurrency = "INR";
    /** Exchange rate locked at bill creation time (1 unit of currency = exchangeRate units of baseCurrency). */
    private Double exchangeRate = 1.0;
    /** Timestamp when exchange rate was recorded. */
    @com.fasterxml.jackson.annotation.JsonFormat(shape = com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss'Z'")
    private LocalDateTime exchangeRateDate;
    /** Total amount converted to baseCurrency. */
    private Double convertedAmount;
    /** Expense category (e.g., Food, Travel, Transport, etc.). Defaults to "Other" for backward compatibility. */
    private String category = "Other";
    @com.fasterxml.jackson.annotation.JsonFormat(shape = com.fasterxml.jackson.annotation.JsonFormat.Shape.STRING, pattern = "yyyy-MM-dd'T'HH:mm:ss'Z'")
    private LocalDateTime createdAt;
}