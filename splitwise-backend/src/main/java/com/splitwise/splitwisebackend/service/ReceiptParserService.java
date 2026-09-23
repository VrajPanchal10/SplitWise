package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.dto.BillItemRequest;
import com.splitwise.splitwisebackend.dto.ReceiptParseResult;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
@Slf4j
public class ReceiptParserService {

    // Keywords to filter out (totals, taxes, footers, etc.)
    private static final String[] SKIP_KEYWORDS = {
            "total", "tax", "gst", "subtotal", "sub total", "thank you", "balance",
            "amount due", "change", "cgst", "sgst", "igst", "round", "return",
            "table", "server", "cashier", "bill no", "invoice", "receipt",
            "order no", "date", "time", "phone", "address", "www", "http",
            "gstin", "cin", "fssai", "qty", "rate", "amount"
    };

    // Keywords that indicate a total line we should prefer for the amount
    private static final String[] TOTAL_KEYWORDS = {
            "total", "amount due", "grand total", "amount payable", "payable",
            "net amount", "net total", "bill total", "to pay", "pay"
    };

    // Patterns
    private static final Pattern ITEM_PATTERN = Pattern.compile("^(.+?)\\s+(\\d{1,7}(?:[.,]\\d{1,2})?)$");
    private static final Pattern MONEY_IN_LINE = Pattern.compile("(\\d{1,7}(?:[.,]\\d{1,2})?)\\s*$");
    private static final Pattern ANY_NUMBER = Pattern.compile("\\d+(?:[.,]\\d+)?");
    private static final Pattern MERCHANT_STOPWORDS = Pattern.compile(
            "(?i)^(\\d+([.,]\\d+)?|total|tax|gst|subtotal|sub total|thank you|balance|amount|change|" +
                    "cgst|sgst|igst|round|return|bill no|invoice|receipt|order no|date|time|phone|" +
                    "web|www|http|table|server|cashier|gstin|cin|fssai|qty|rate|amount|\\*|#|-|—|\\.+)$"
    );

    /**
     * Parses raw OCR text from a receipt image and extracts line items, a
     * suggested title, and the most likely total amount.
     *
     * Strategy:
     * 1. Find a "total" line (keywords like total/amount due/grand total) and
     *    prefer its number over summing items - summing is fragile when OCR
     *    misreads individual item lines.
     * 2. Suggest a title from the first non-empty, reasonably long text line
     *    (typically the restaurant/store name at the top of the receipt).
     * 3. Compute a confidence level based on how many numeric tokens / items
     *    we detected. If confidence is too low, return an essentially empty
     *    result so the frontend shows blank fields for manual entry instead of
     *    garbage auto-filled values.
     *
     * @param rawOcrText the raw text extracted from OCR
     * @return ReceiptParseResult with items, suggestedTitle, totalAmount, confidence
     */
    public ReceiptParseResult parseReceiptText(String rawOcrText) {
        log.info("ReceiptParserService received OCR text (length={}):\n{}",
                rawOcrText == null ? 0 : rawOcrText.length(), rawOcrText);
        ReceiptParseResult result = new ReceiptParseResult();

        if (rawOcrText == null || rawOcrText.trim().isEmpty()) {
            result.setConfidence("LOW");
            return result;
        }

        // Split OCR text into lines
        String[] lines = rawOcrText.split("\\r?\\n");

        // --- Pass 1: detect total line (preferred over summing) ---
        Double detectedTotal = detectTotal(lines);
        result.setTotalAmount(detectedTotal);

        // --- Pass 2: extract item lines ---
        List<BillItemRequest> items = extractItems(lines);
        result.setItems(items);

        // --- Pass 3: suggest a title (first reasonable merchant-like line) ---
        result.setSuggestedTitle(suggestTitle(lines));

        // --- Pass 4: confidence & minimal-result guard ---
        int numericTokens = 0;
        for (String line : lines) {
            if (line != null) {
                numericTokens += countNumbers(line);
            }
        }

        // Confidence heuristic:
        // - HIGH if we found a total AND at least 2 numeric tokens elsewhere
        // - MEDIUM if we found a total OR at least 3 item prices
        // - LOW otherwise
        String confidence;
        if (detectedTotal != null && numericTokens >= 2) {
            confidence = "HIGH";
        } else if (detectedTotal != null || items.size() >= 3) {
            confidence = "MEDIUM";
        } else {
            confidence = "LOW";
        }
        result.setConfidence(confidence);

        // If confidence is very low, discard the fragile data entirely so the
        // UI shows blank fields for manual entry instead of wrong values.
        if ("LOW".equals(confidence)) {
            result.setItems(new ArrayList<>());
            result.setTotalAmount(null);
            result.setSuggestedTitle(null);
        }

        log.info("Parsed {} items, total={}, title='{}', confidence={}",
                result.getItems().size(), result.getTotalAmount(), result.getSuggestedTitle(), confidence);

        return result;
    }

    /**
     * Looks through the lines for one containing a "total"-type keyword and
     * returns the last money value on that line. Returns null if none found.
     */
    private Double detectTotal(String[] lines) {
        for (String line : lines) {
            if (line == null) continue;
            String lowerLine = line.toLowerCase();
            boolean isTotalLine = false;
            for (String keyword : TOTAL_KEYWORDS) {
                if (lowerLine.contains(keyword)) {
                    isTotalLine = true;
                    break;
                }
            }
            if (!isTotalLine) continue;

            // Find the last money-like number on that line (handles things like
            // "Total: 1,234.56" or "TOTAL Rs 456")
            Matcher m = MONEY_IN_LINE.matcher(line);
            if (m.find()) {
                Double val = parseMoney(m.group(1));
                if (val != null && val > 0) {
                    log.debug("Detected total '{}' from line '{}'", val, line);
                    return val;
                }
            }
        }
        return null;
    }

    /**
     * Extracts item lines: text followed by a price, filtering out
     * total/tax/footer keywords.
     */
    private List<BillItemRequest> extractItems(String[] lines) {
        List<BillItemRequest> items = new ArrayList<>();

        for (String line : lines) {
            if (line == null) continue;
            line = line.trim();
            if (line.isEmpty()) continue;

            String lowerLine = line.toLowerCase();
            if (containsAny(lowerLine, SKIP_KEYWORDS)) continue;

            Matcher matcher = ITEM_PATTERN.matcher(line);
            if (matcher.find()) {
                String name = matcher.group(1).trim();
                String priceStr = matcher.group(2);

                // A line-item name should contain at least some letters;
                // pure-numbers or pure-punctuation lines are noise.
                if (!name.matches(".*[A-Za-z].*")) continue;

                Double price = parseMoney(priceStr);
                if (price != null && price > 0.01) {
                    BillItemRequest item = new BillItemRequest();
                    item.setName(name);
                    item.setPrice(price);
                    item.setSharedByUserIds(new ArrayList<>());
                    items.add(item);
                }
            }
        }
        return items;
    }

    /**
     * Returns the first line that looks like a merchant/store name: non-empty,
     * reasonably long, not a number/total/tax keyword, and containing letters.
     */
    private String suggestTitle(String[] lines) {
        for (String line : lines) {
            if (line == null) continue;
            line = line.trim();
            if (line.isEmpty()) continue;

            // A good title is typically a few words (not just a number, not a keyword)
            if (line.length() < 3) continue;
            if (line.length() > 80) continue;
            if (MERCHANT_STOPWORDS.matcher(line).matches()) continue;

            // Must contain letters (exclude pure price/noise lines)
            if (!line.matches(".*[A-Za-z].*")) continue;

            // Prefer lines that don't look like item lines (no trailing price),
            // since store names usually won't have a price on the same line.
            if (MoneyUtils.hasTrailingMoney(line)) continue;

            return line;
        }
        return null;
    }

    private boolean containsAny(String lowerText, String[] keywords) {
        for (String keyword : keywords) {
            if (lowerText.contains(keyword)) {
                return true;
            }
        }
        return false;
    }

    private int countNumbers(String line) {
        Matcher m = ANY_NUMBER.matcher(line);
        int count = 0;
        while (m.find()) count++;
        return count;
    }

    /**
     * Parses a money string like "1,234.56", "1234.56", or "45" into a double.
     * Returns null on failure or non-positive values.
     */
    private Double parseMoney(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try {
            // Strip thousands separators and currency symbols, normalize decimal comma
            String cleaned = raw.replaceAll("[^\\d.,-]", "");
            // If there's a comma that looks like a thousands separator, remove it
            if (cleaned.matches("\\d{1,3}(,\\d{3})+(\\.\\d+)?")) {
                cleaned = cleaned.replace(",", "");
            } else {
                cleaned = cleaned.replace(",", ".");
            }
            Double value = Double.parseDouble(cleaned);
            return value > 0 ? value : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * Small helper for trailing-money detection used by title suggestion.
     */
    private static class MoneyUtils {
        private static final Pattern TRAILING_MONEY = Pattern.compile("\\d{1,7}(?:[.,]\\d{1,2})?\\s*$");

        static boolean hasTrailingMoney(String line) {
            return TRAILING_MONEY.matcher(line).find();
        }
    }
}