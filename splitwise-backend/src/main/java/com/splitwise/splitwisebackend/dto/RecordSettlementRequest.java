package com.splitwise.splitwisebackend.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RecordSettlementRequest {
    private String groupId;

    @NotBlank(message = "fromUserId is required")
    private String fromUserId;

    @NotBlank(message = "toUserId is required")
    private String toUserId;

    @NotNull(message = "amount is required")
    @DecimalMin(value = "0.01", message = "amount must be greater than 0")
    private Double amount;

    private String currency;

    private String notes;
}
