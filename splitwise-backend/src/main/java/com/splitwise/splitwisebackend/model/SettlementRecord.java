package com.splitwise.splitwisebackend.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "settlements")
public class SettlementRecord {
    @Id
    private String id;
    private String groupId;
    private String fromUserId;
    private String toUserId;
    private Double amount;
    private Status status;
    private LocalDateTime createdAt;
    private LocalDateTime paidAt;

    public enum Status {
        PENDING,
        PAID
    }
}