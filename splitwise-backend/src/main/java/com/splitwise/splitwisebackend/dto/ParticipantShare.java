package com.splitwise.splitwisebackend.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ParticipantShare {
    private String userId;
    private String name;
    private Double paidAmount;
    private Double shareAmount;
    private Double netAmount;
}
