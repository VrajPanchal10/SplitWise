package com.splitwise.splitwisebackend.dto;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * Structured result of parsing raw OCR text from a receipt.
 *
 * Contains the list of line items plus a suggested title, financial summary
 * fields (subtotal, tax, discount, grand total, etc.), and a confidence
 * indicator so the frontend can decide how much of the auto-parsed data to
 * trust.
 */
@Data
public class ReceiptParseResult {
    private List<BillItemRequest> items = new ArrayList<>();
    private String suggestedTitle;
    private Double totalAmount;
    /** LOW, MEDIUM, or HIGH - how confident we are in the parsed values. */
    private String confidence = "LOW";

    // --- Financial breakdown fields ---
    private Double subtotal;
    private Double discount;
    private Double cgst;
    private Double sgst;
    private Double tax;
    private Double serviceCharge;
    private Double roundOff;
    /** The raw OCR text, preserved for debugging/manual review. */
    private String rawText;
}