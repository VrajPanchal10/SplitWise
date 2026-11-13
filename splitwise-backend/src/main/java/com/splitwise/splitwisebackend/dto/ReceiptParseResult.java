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
    /** Detected currency code (e.g., USD, INR, EUR, GBP). Defaults to INR if undetermined. */
    private String currency = "INR";

    // --- Financial breakdown fields ---
    private Double subtotal;
    private Double discount;
    private Double cgst;
    private Double sgst;
    private Double tax;
    private Double serviceCharge;
    private Double tip;
    private Double roundOff;
    private Double amountPaid;
    private Double change;

    // --- Validation and Confidence Details ---
    /** VALIDATED, PARTIALLY_VALIDATED, UNVERIFIED, or FAILED_VALIDATION */
    private String validationStatus = "UNVERIFIED";
    /** Human-readable explanation of the validation result */
    private String validationMessage;
    /** OCR text recognition confidence (HIGH, MEDIUM, LOW) */
    private String ocrConfidence = "LOW";
    /** Semantic parsing confidence (HIGH, MEDIUM, LOW) */
    private String parsingConfidence = "LOW";

    /** The raw OCR text, preserved for debugging/manual review. */
    private String rawText;
}