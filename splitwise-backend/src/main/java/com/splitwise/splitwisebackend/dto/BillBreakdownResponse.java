package com.splitwise.splitwisebackend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BillBreakdownResponse {
    private String billId;
    private String title;
    private Double totalAmount;
    private String paidBy;
    private String paidByName;
    private int participantCount;
    private List<ParticipantShare> participants;
}
