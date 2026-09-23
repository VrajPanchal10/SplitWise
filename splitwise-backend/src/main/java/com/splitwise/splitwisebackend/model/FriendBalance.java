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
@Document(collection = "friend_balances")
public class FriendBalance {
    @Id
    private String id;
    private String userId;
    private String friendId;
    private Double netBalance; // positive = owes you, negative = you owe
    private LocalDateTime createdAt;
}