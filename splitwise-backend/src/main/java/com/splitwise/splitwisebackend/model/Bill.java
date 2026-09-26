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
    private LocalDateTime createdAt;
}