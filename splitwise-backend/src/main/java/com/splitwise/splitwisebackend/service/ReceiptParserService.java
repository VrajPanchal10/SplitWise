package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.dto.BillItemRequest;
import com.splitwise.splitwisebackend.dto.ReceiptParseResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Staged receipt OCR text parser.
 *
 * <p>Pipeline stages:
 * <ol>
 *   <li><b>Normalize</b> – whitespace, OCR currency mistakes, safe char substitutions</li>
 *   <li><b>Detect metadata</b> – merchant/title, filter column-header lines</li>
 *   <li><b>Extract line items</b> – multi-format support (item qty unit total, item qty total, item amount)</li>
 *   <li><b>Extract financial fields</b> – subtotal, tax, CGST, SGST, discount, service charge, round-off, grand total</li>
 *   <li><b>Final total selection</b> – prefer GRAND TOTAL > TOTAL > AMOUNT PAYABLE > NET PAYABLE, avoid subtotal</li>
 *   <li><b>Numeric validation</b> – cross-check qty × unit vs total, reject impossible values</li>
 *   <li><b>Confidence scoring</b> – based on internal consistency, not just presence of numbers</li>
 * </ol>
 */
@Service
@Slf4j
public class ReceiptParserService {

    // ========================================================================
    // STAGE 1: Normalization patterns
    // ========================================================================

    /** Common OCR misreadings of currency symbols / prefixes. */
    private static final Pattern OCR_CURRENCY_NOISE = Pattern.compile(
            "(?i)[₹$€£¥]|\\bRs\\.?\\s*|\\bINR\\s*|\\bRUPEES?\\s*");

    /** OCR often produces 'O' for '0', 'l'/'I' for '1', 'S' for '5' in
     *  numeric contexts. We only fix these inside number-like tokens. */
    private static final Pattern NUMERIC_LIKE_TOKEN = Pattern.compile(
            "(?<=\\s|^)([OoIlSsBb\\d][OoIlSsBb\\d,.]+)(?=\\s|$)");

    // ========================================================================
    // STAGE 2: Metadata detection
    // ========================================================================

    /** Lines that are clearly column headers and should never be treated as items. */
    private static final Pattern COLUMN_HEADER_LINE = Pattern.compile(
            "(?i)^\\s*(SR\\.?\\s*(NO\\.?)?\\s+)?" +
            "(ITEM|DESCRIPTION|PARTICULARS|PRODUCT)\\s+" +
            "(QTY|QUANTITY|Q\\.?TY)\\s+" +
            "(RATE|UNIT|U\\.?PRICE|PRICE|MRP)?" +
            "\\s*(AMOUNT|TOTAL|AMT|VALUE)?\\s*$");

    /** Alternative simpler header patterns (e.g., just "QTY   RATE   AMOUNT"). */
    private static final Pattern SIMPLE_HEADER_LINE = Pattern.compile(
            "(?i)^\\s*(QTY|QUANTITY)\\s+(RATE|PRICE|MRP|UNIT)\\s+(AMOUNT|TOTAL|AMT)\\s*$");

    /** Stop-words that indicate a line is NOT a merchant name. */
    private static final Pattern MERCHANT_STOPWORDS = Pattern.compile(
            "(?i)^(\\d+([.,]\\d+)?|total|sub\\s*total|tax|gst|cgst|sgst|igst|" +
            "thank\\s*you|balance|amount|change|round|return|bill\\s*no|invoice|receipt|" +
            "order\\s*no|date|time|phone|web|www|http|table|server|cashier|gstin|cin|" +
            "fssai|qty|rate|amount|discount|service|charge|payable|net|grand|" +
            "\\*+|#+|-+|—+|\\.{3,}|={3,})$");

    // ========================================================================
    // STAGE 3: Item extraction patterns (multiple formats)
    // ========================================================================

    /**
     * Format: item-name  qty  unit-price  total-price
     * Example: "Butter Chicken  2  250.00  500.00"
     */
    private static final Pattern ITEM_QTY_UNIT_TOTAL = Pattern.compile(
            "^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s*$");

    /**
     * Format: item-name  qty  total-price
     * Example: "Butter Chicken  2  500.00"
     * We distinguish from 2-number-item by requiring the first number to be
     * a plausible quantity (≤ 999) and the second to be larger.
     */
    private static final Pattern ITEM_QTY_TOTAL = Pattern.compile(
            "^(.+?)\\s+(\\d{1,3}(?:[.,]\\d+)?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s*$");

    /**
     * Format: item-name  amount
     * Example: "Butter Chicken  500.00" or "Silver Chain  3,500.00"
     */
    private static final Pattern ITEM_AMOUNT = Pattern.compile(
            "^(.+?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s*$");

    // ========================================================================
    // STAGE 4: Financial field patterns
    // ========================================================================

    /** Maps keyword patterns to their semantic meaning. Order matters for priority. */
    private static final String[][] FINANCIAL_KEYWORDS = {
            // key,                regex pattern (case-insensitive)
            {"grandTotal",         "(?i)(grand\\s*total|net\\s*(payable|amount|total)|amount\\s*payable|" +
                                   "bill\\s*total|total\\s*payable|to\\s*pay|you\\s*pay|final\\s*total)"},
            {"subtotal",           "(?i)(sub\\s*total|subtotal|sub-total|items?\\s*total)"},
            {"cgst",               "(?i)(cgst|c\\.?g\\.?s\\.?t\\.?)"},
            {"sgst",               "(?i)(sgst|s\\.?g\\.?s\\.?t\\.?)"},
            {"tax",                "(?i)(\\btax\\b|vat|gst(?!in)|service\\s*tax)"},
            {"serviceCharge",      "(?i)(service\\s*charge|svc\\s*charge|\\bs\\.?c\\.?\\b)"},
            {"discount",           "(?i)(discount|disc\\.?|offer|savings?)"},
            {"roundOff",           "(?i)(round\\s*(off|adj)|rounding|adj(ust)?ment)"},
            // Generic "total" last — only used if grandTotal didn't match
            {"total",              "(?i)(?<!sub\\s?)(?<!sub)\\btotal\\b(?!\\s*(items?|qty|quantity))"},
    };

    /** Keywords that indicate a line is a financial summary line (not an item). */
    private static final Pattern FINANCIAL_LINE_INDICATOR = Pattern.compile(
            "(?i)(sub\\s*total|subtotal|total|grand\\s*total|amount\\s*(payable|due)|" +
            "net\\s*(payable|amount|total)|cgst|sgst|igst|gst(?!in)|\\btax\\b|vat|" +
            "discount|disc\\b|round\\s*off|rounding|service\\s*charge|\\bsvc\\b|to\\s*pay|" +
            "you\\s*pay|bill\\s*total|\\bchange\\b|\\bbalance\\b|\\btender\\b|\\bcash\\b|\\bcard\\b|\\bupi\\b|\\bpaid\\b|" +
            "thank\\s*you|visit\\s*again|\\*{3,}|={3,}|-{3,})");

    /** Matches any number (possibly with decimal/comma/thousands) at the end of a line. */
    private static final Pattern TRAILING_NUMBER = Pattern.compile(
            "([+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s*$");

    /** Matches any number in a string. */
    private static final Pattern ANY_NUMBER = Pattern.compile("\\d+(?:[.,]\\d+)?");

    // ========================================================================
    // Maximum values – anything above is almost certainly OCR garbage
    // ========================================================================
    private static final double MAX_REASONABLE_ITEM_PRICE = 500_000.0;
    private static final double MAX_REASONABLE_TOTAL = 5_000_000.0;
    private static final double MAX_REASONABLE_QTY = 999.0;

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Parses raw OCR text through a staged pipeline and returns a structured
     * {@link ReceiptParseResult}.
     */
    public ReceiptParseResult parseReceiptText(String rawOcrText) {
        log.info("ReceiptParserService received OCR text (length={}):\n{}",
                rawOcrText == null ? 0 : rawOcrText.length(), rawOcrText);

        ReceiptParseResult result = new ReceiptParseResult();
        result.setRawText(rawOcrText);

        if (rawOcrText == null || rawOcrText.trim().isEmpty()) {
            result.setConfidence("LOW");
            return result;
        }

        // ---- Stage 1: Normalize ----
        String normalizedText = normalizeOcrText(rawOcrText);
        String[] lines = normalizedText.split("\\r?\\n");

        // ---- Stage 2: Detect metadata (title) ----
        result.setSuggestedTitle(suggestTitle(lines));

        // ---- Stage 3: Extract line items ----
        List<BillItemRequest> items = extractItems(lines);
        result.setItems(items);

        // ---- Stage 4: Extract financial fields ----
        Map<String, Double> financials = extractFinancialFields(lines);
        result.setSubtotal(financials.get("subtotal"));
        result.setCgst(financials.get("cgst"));
        result.setSgst(financials.get("sgst"));
        result.setTax(financials.get("tax"));
        result.setServiceCharge(financials.get("serviceCharge"));
        result.setDiscount(financials.get("discount"));
        result.setRoundOff(financials.get("roundOff"));

        // ---- Stage 5: Final total selection ----
        Double finalTotal = selectFinalTotal(financials, items);
        result.setTotalAmount(finalTotal);

        // ---- Stage 6: Numeric validation ----
        validateItems(items);

        // ---- Stage 7: Confidence scoring ----
        String confidence = computeConfidence(result, items, financials);
        result.setConfidence(confidence);

        // If confidence is LOW and items are empty, clear fragile data
        if ("LOW".equals(confidence) && items.isEmpty()) {
            result.setTotalAmount(null);
            result.setSuggestedTitle(null);
        }

        log.info("Parsed {} items, total={}, title='{}', confidence={}, financials={}",
                result.getItems().size(), result.getTotalAmount(),
                result.getSuggestedTitle(), confidence, financials);

        return result;
    }

    // ========================================================================
    // Stage 1: Normalization
    // ========================================================================

    /**
     * Normalizes raw OCR text:
     * - Collapses multiple spaces/tabs to single space
     * - Strips currency symbols and prefixes
     * - Fixes common OCR character substitutions in numeric contexts only
     * - Trims each line
     */
    String normalizeOcrText(String raw) {
        if (raw == null) return "";

        StringBuilder sb = new StringBuilder();
        for (String line : raw.split("\\r?\\n")) {
            // Strip currency symbols/prefixes first
            String normalized = OCR_CURRENCY_NOISE.matcher(line).replaceAll("");

            // Fix OCR digit substitutions only in number-like tokens
            normalized = fixOcrDigits(normalized);

            // Collapse multiple spaces/tabs to a single space and trim
            normalized = normalized.replaceAll("[\\t ]+", " ").trim();

            sb.append(normalized).append("\n");
        }
        return sb.toString().trim();
    }

    /**
     * Fixes common OCR misreads in tokens that look like they should be numbers.
     * Only applies when the token is predominantly digits with a few misread chars.
     */
    private String fixOcrDigits(String line) {
        Matcher m = NUMERIC_LIKE_TOKEN.matcher(line);
        StringBuilder result = new StringBuilder();
        int lastEnd = 0;
        while (m.find()) {
            result.append(line, lastEnd, m.start());
            String token = m.group(1);

            // Count how many chars look like digits vs letters
            int digitLike = 0;
            int letterLike = 0;
            for (char c : token.toCharArray()) {
                if (Character.isDigit(c) || c == '.' || c == ',') digitLike++;
                else if ("OoIlSsBb".indexOf(c) >= 0) letterLike++;
                else letterLike += 2; // clearly not a number
            }

            // Only fix if >50% of chars are digit-like or common OCR substitutions
            if (digitLike > 0 && letterLike <= digitLike) {
                token = token.replace('O', '0').replace('o', '0')
                        .replace('I', '1').replace('l', '1')
                        .replace('S', '5').replace('s', '5')
                        .replace('B', '8').replace('b', '8');
            }
            result.append(token);
            lastEnd = m.end();
        }
        result.append(line, lastEnd, line.length());
        return result.toString();
    }

    // ========================================================================
    // Stage 2: Metadata / Title
    // ========================================================================

    /**
     * Returns the first line that looks like a merchant/store name:
     * non-empty, 3-80 chars, contains letters, not a financial/column-header
     * line, and doesn't end with a trailing price.
     */
    String suggestTitle(String[] lines) {
        for (String line : lines) {
            if (line == null) continue;
            line = line.trim();
            if (line.isEmpty() || line.length() < 3 || line.length() > 80) continue;
            if (MERCHANT_STOPWORDS.matcher(line).matches()) continue;
            if (!line.matches(".*[A-Za-z].*")) continue;
            if (COLUMN_HEADER_LINE.matcher(line).matches()) continue;
            if (SIMPLE_HEADER_LINE.matcher(line).matches()) continue;
            if (FINANCIAL_LINE_INDICATOR.matcher(line).find()) continue;
            // Skip lines with trailing money (likely item lines)
            if (TRAILING_NUMBER.matcher(line).find()) continue;
            return line;
        }
        return null;
    }

    // ========================================================================
    // Stage 3: Item Extraction
    // ========================================================================

    /**
     * Extracts line items from OCR lines. Supports three formats:
     * <ol>
     *   <li>item qty unitPrice totalPrice</li>
     *   <li>item qty totalPrice</li>
     *   <li>item amount</li>
     * </ol>
     * Skips financial summary lines, column headers, and lines with
     * impossible values.
     */
    List<BillItemRequest> extractItems(String[] lines) {
        List<BillItemRequest> items = new ArrayList<>();

        for (String line : lines) {
            if (line == null) continue;
            line = line.trim();
            if (line.isEmpty()) continue;

            // Skip financial lines
            if (FINANCIAL_LINE_INDICATOR.matcher(line).find()) continue;
            // Skip column headers
            if (COLUMN_HEADER_LINE.matcher(line).matches()) continue;
            if (SIMPLE_HEADER_LINE.matcher(line).matches()) continue;

            BillItemRequest item = tryParseItemLine(line);
            if (item != null) {
                items.add(item);
            }
        }
        return items;
    }

    /**
     * Tries all item patterns on a line and returns the best match,
     * or null if none match.
     */
    private BillItemRequest tryParseItemLine(String line) {
        // Try 4-column format first (most specific)
        Matcher m4 = ITEM_QTY_UNIT_TOTAL.matcher(line);
        if (m4.matches()) {
            String name = cleanItemName(m4.group(1));
            Double qty = parseMoney(m4.group(2));
            Double unitPrice = parseMoney(m4.group(3));
            Double total = parseMoney(m4.group(4));

            if (isValidItemName(name) && total != null && total > 0
                    && total <= MAX_REASONABLE_ITEM_PRICE) {
                BillItemRequest item = new BillItemRequest();
                item.setName(name);
                item.setPrice(total);
                item.setQuantity(qty);
                item.setUnitPrice(unitPrice);
                item.setSharedByUserIds(new ArrayList<>());
                return item;
            }
        }

        // Try 3-column format (item qty total)
        Matcher m3 = ITEM_QTY_TOTAL.matcher(line);
        if (m3.matches()) {
            String name = cleanItemName(m3.group(1));
            Double qty = parseMoney(m3.group(2));
            Double total = parseMoney(m3.group(3));

            // Disambiguate: if "qty" is too large, this is probably item + amount
            if (qty != null && qty <= MAX_REASONABLE_QTY
                    && isValidItemName(name) && total != null && total > 0
                    && total <= MAX_REASONABLE_ITEM_PRICE) {
                BillItemRequest item = new BillItemRequest();
                item.setName(name);
                item.setPrice(total);
                item.setQuantity(qty);
                // Derive unit price if quantity > 0
                if (qty > 0) {
                    item.setUnitPrice(Math.round(total / qty * 100.0) / 100.0);
                }
                item.setSharedByUserIds(new ArrayList<>());
                return item;
            }
        }

        // Try 2-column format (item amount)
        Matcher m2 = ITEM_AMOUNT.matcher(line);
        if (m2.matches()) {
            String name = cleanItemName(m2.group(1));
            Double price = parseMoney(m2.group(2));

            if (isValidItemName(name) && price != null && price > 0.01
                    && price <= MAX_REASONABLE_ITEM_PRICE) {
                BillItemRequest item = new BillItemRequest();
                item.setName(name);
                item.setPrice(price);
                item.setQuantity(null);
                item.setUnitPrice(null);
                item.setSharedByUserIds(new ArrayList<>());
                return item;
            }
        }

        return null;
    }

    private String cleanItemName(String name) {
        if (name == null) return "";
        // Remove leading serial numbers like "1.", "1)", "01."
        name = name.replaceAll("^\\d{1,3}[.)\\s]+", "");
        // Remove trailing dots, dashes, spaces
        name = name.replaceAll("[.\\-\\s]+$", "");
        return name.trim();
    }

    private boolean isValidItemName(String name) {
        if (name == null || name.length() < 2) return false;
        // Must contain at least one letter
        if (!name.matches(".*[A-Za-z].*")) return false;
        // Should not be a pure financial keyword
        if (FINANCIAL_LINE_INDICATOR.matcher(name).find()) return false;
        return true;
    }

    // ========================================================================
    // Stage 4: Financial Fields Extraction
    // ========================================================================

    /**
     * Scans all lines and extracts financial summary values.
     * Returns a map with keys: subtotal, cgst, sgst, tax, serviceCharge,
     * discount, roundOff, grandTotal, total.
     */
    Map<String, Double> extractFinancialFields(String[] lines) {
        Map<String, Double> result = new LinkedHashMap<>();

        for (String line : lines) {
            if (line == null) continue;
            line = line.trim();
            if (line.isEmpty()) continue;

            for (String[] entry : FINANCIAL_KEYWORDS) {
                String key = entry[0];
                String regex = entry[1];

                // Skip if we already found this field (first occurrence wins)
                if (result.containsKey(key)) continue;

                if (Pattern.compile(regex).matcher(line).find()) {
                    Matcher numMatcher = TRAILING_NUMBER.matcher(line);
                    if (numMatcher.find()) {
                        Double value = parseMoney(numMatcher.group(1));
                        if (value != null && Math.abs(value) <= MAX_REASONABLE_TOTAL) {
                            result.put(key, value);
                            log.debug("Financial field '{}' = {} from line: {}", key, value, line);
                        }
                    }
                    break; // A line matches at most one financial keyword
                }
            }
        }
        return result;
    }

    // ========================================================================
    // Stage 5: Final Total Selection
    // ========================================================================

    /**
     * Selects the most appropriate total amount:
     * 1. Prefer explicit grandTotal (GRAND TOTAL / AMOUNT PAYABLE / NET PAYABLE)
     * 2. Then generic "total" (but NOT subtotal)
     * 3. Then compute from subtotal + tax fields
     * 4. Then sum of item prices as last resort
     * 5. null if nothing is found
     */
    Double selectFinalTotal(Map<String, Double> financials, List<BillItemRequest> items) {
        // Priority 1: Grand total / amount payable
        Double grandTotal = financials.get("grandTotal");
        if (grandTotal != null && grandTotal > 0) {
            log.info("Using grandTotal={} as final total", grandTotal);
            return grandTotal;
        }

        // Priority 2: Generic "total" (which we only matched if it's not "subtotal")
        Double total = financials.get("total");
        if (total != null && total > 0) {
            // Cross-check: if we also have a subtotal and total <= subtotal,
            // the "total" is probably the subtotal mislabeled; skip it
            Double subtotal = financials.get("subtotal");
            if (subtotal != null && total <= subtotal && !total.equals(subtotal)) {
                log.warn("Detected 'total'={} <= subtotal={}, skipping as likely mislabeled", total, subtotal);
            } else {
                log.info("Using total={} as final total", total);
                return total;
            }
        }

        // Priority 3: Compute from subtotal + taxes - discount
        Double subtotal = financials.get("subtotal");
        if (subtotal != null && subtotal > 0) {
            double computed = subtotal;
            Double tax = financials.get("tax");
            Double cgst = financials.get("cgst");
            Double sgst = financials.get("sgst");
            Double sc = financials.get("serviceCharge");
            Double disc = financials.get("discount");
            Double roundOff = financials.get("roundOff");

            if (cgst != null) computed += cgst;
            if (sgst != null) computed += sgst;
            if (tax != null && cgst == null && sgst == null) computed += tax;
            if (sc != null) computed += sc;
            if (disc != null) computed -= disc;
            if (roundOff != null) computed += roundOff;

            computed = Math.round(computed * 100.0) / 100.0;
            log.info("Computed total from subtotal: {} (subtotal={}, tax/cgst/sgst, disc, roundOff)", computed, subtotal);
            return computed;
        }

        // Priority 4: Sum of item prices
        if (!items.isEmpty()) {
            double itemSum = items.stream()
                    .mapToDouble(i -> i.getPrice() != null ? i.getPrice() : 0.0)
                    .sum();
            if (itemSum > 0) {
                itemSum = Math.round(itemSum * 100.0) / 100.0;
                log.info("Using sum of {} item prices as fallback total: {}", items.size(), itemSum);
                return itemSum;
            }
        }

        // Priority 5: Give up
        log.info("No total could be determined");
        return null;
    }

    // ========================================================================
    // Stage 6: Numeric Validation
    // ========================================================================

    /**
     * Validates extracted items:
     * - Checks qty × unitPrice ≈ total (within 2% tolerance)
     * - Rejects items with impossible prices
     * - Logs warnings for suspicious values
     */
    void validateItems(List<BillItemRequest> items) {
        List<BillItemRequest> toRemove = new ArrayList<>();
        for (BillItemRequest item : items) {
            // Reject impossible prices
            if (item.getPrice() != null && item.getPrice() > MAX_REASONABLE_ITEM_PRICE) {
                log.warn("Rejecting item '{}' with impossible price {}", item.getName(), item.getPrice());
                toRemove.add(item);
                continue;
            }

            // Cross-check qty × unitPrice vs total
            if (item.getQuantity() != null && item.getUnitPrice() != null && item.getPrice() != null) {
                double expected = Math.round(item.getQuantity() * item.getUnitPrice() * 100.0) / 100.0;
                double actual = item.getPrice();
                double diff = Math.abs(expected - actual);
                double tolerance = actual * 0.02; // 2% tolerance
                if (diff > Math.max(tolerance, 1.0)) {
                    log.warn("Item '{}': qty({}) × unit({}) = {} ≠ total({}), diff={}",
                            item.getName(), item.getQuantity(), item.getUnitPrice(), expected, actual, diff);
                    // Don't reject, but clear qty/unitPrice to signal uncertainty
                    item.setQuantity(null);
                    item.setUnitPrice(null);
                }
            }
        }
        items.removeAll(toRemove);
    }

    // ========================================================================
    // Stage 7: Confidence Scoring
    // ========================================================================

    /**
     * Computes confidence based on internal consistency:
     * <ul>
     *   <li><b>HIGH</b>: total found AND ≥1 items AND item-sum is within 30% of total
     *       (or total comes from grandTotal/subtotal computation)</li>
     *   <li><b>MEDIUM</b>: total found OR ≥2 items, but consistency checks fail</li>
     *   <li><b>LOW</b>: neither total nor meaningful items found</li>
     * </ul>
     */
    String computeConfidence(ReceiptParseResult result, List<BillItemRequest> items,
                             Map<String, Double> financials) {
        Double total = result.getTotalAmount();
        boolean hasTotal = total != null && total > 0;
        boolean hasItems = !items.isEmpty();
        boolean hasGrandTotal = financials.containsKey("grandTotal");
        boolean hasSubtotal = financials.containsKey("subtotal");

        if (!hasTotal && !hasItems) {
            return "LOW";
        }

        if (hasTotal && hasItems) {
            // Check consistency: sum of items vs total
            double itemSum = items.stream()
                    .mapToDouble(i -> i.getPrice() != null ? i.getPrice() : 0.0)
                    .sum();

            if (itemSum > 0 && total > 0) {
                double ratio = itemSum / total;
                // Items should be ≤ total (items are pre-tax usually) and
                // not wildly different. Ratio between 0.5 and 1.3 is acceptable.
                if (ratio >= 0.5 && ratio <= 1.3) {
                    return "HIGH";
                }
                // If we have explicit grand total + subtotal, trust the structure
                if (hasGrandTotal || hasSubtotal) {
                    return "MEDIUM";
                }
                log.warn("Item sum {} vs total {} ratio={} – marking MEDIUM", itemSum, total, ratio);
                return "MEDIUM";
            }

            // Items exist but sum is 0 or total is somehow problematic
            return "MEDIUM";
        }

        if (hasTotal) {
            // Total found but no items
            return "MEDIUM";
        }

        // Items found but no total
        if (items.size() >= 2) {
            return "MEDIUM";
        }

        return "LOW";
    }

    // ========================================================================
    // Utility methods
    // ========================================================================

    /**
     * Parses a money string like "1,234.56", "1234.56", or "45" into a double.
     * Returns null on failure or non-positive values.
     */
    Double parseMoney(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            // Strip non-numeric chars except digits, dots, commas, minus
            String cleaned = raw.replaceAll("[^\\d.,-]", "");
            if (cleaned.isEmpty()) return null;

            // Handle negative (e.g., discount: "-50.00")
            boolean negative = cleaned.startsWith("-");
            if (negative) cleaned = cleaned.substring(1);

            // If comma looks like a thousands separator (e.g., "1,234.56" or "1,234")
            if (cleaned.matches("\\d{1,3}(,\\d{3})+(\\.\\d+)?")) {
                cleaned = cleaned.replace(",", "");
            } else {
                // Comma as decimal separator
                cleaned = cleaned.replace(",", ".");
            }

            // Handle multiple dots (OCR garbage)
            long dotCount = cleaned.chars().filter(c -> c == '.').count();
            if (dotCount > 1) {
                // Keep only the last dot as decimal
                int lastDot = cleaned.lastIndexOf('.');
                cleaned = cleaned.substring(0, lastDot).replace(".", "") + cleaned.substring(lastDot);
            }

            Double value = Double.parseDouble(cleaned);
            if (negative) value = -value;
            return value;
        } catch (NumberFormatException e) {
            return null;
        }
    }
}