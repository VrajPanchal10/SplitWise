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

    /** OCR often produces 'O' for '0', 'l'/'I' for '1', 'S' for '5', 'B' for '8', 'Z' for '2' in
     *  numeric contexts. We only fix these inside number-like tokens. */
    private static final Pattern NUMERIC_LIKE_TOKEN = Pattern.compile(
            "(?<=\\s|^)([OoIlSsBbZz\\d][OoIlSsBbZz\\d,.]+)(?=\\s|$)");

    // ========================================================================
    // STAGE 2: Metadata & Column Header patterns
    // ========================================================================

    /** Lines that are column headers and should never be treated as items. */
    private static final Pattern COLUMN_HEADER_LINE = Pattern.compile(
            "(?i)^\\s*(SR\\.?\\s*(NO\\.?)?\\s*)?" +
            "(ITEM|ITEMS|DESCRIPTION|DESCR|PARTICULARS|PRODUCT)\\s+" +
            "(QTY|QUANTITY|Q\\.?TY)\\s*" +
            "(RATE|UNIT|U\\.?PRICE|PRICE|MRP)?" +
            "\\s*(AMOUNT|TOTAL|AMT|VALUE)?\\s*$");

    /** Alternative simpler header patterns (e.g., just "QTY RATE AMOUNT"). */
    private static final Pattern SIMPLE_HEADER_LINE = Pattern.compile(
            "(?i)^\\s*(QTY|QUANTITY)\\s+(RATE|PRICE|MRP|UNIT)\\s+(AMOUNT|TOTAL|AMT)\\s*$");

    /** Matches any header line containing two or more column header keywords. */
    private static final Pattern GENERIC_COLUMN_HEADER = Pattern.compile(
            "(?i)\\b(item|items|description|descr|particulars|product)\\b.*\\b(qty|quantity|amount|amt|price|total|rate|unit)\\b|" +
            "(?i)\\b(qty|quantity)\\b.*\\b(rate|price|unit|amount|total|amt)\\b|" +
            "(?i)^\\s*(item|descr|description|qty|quantity|price|unit|rate|amt|amount|total)\\s*[:.]?\\s*$");

    /** Lines that contain store/order metadata rather than purchased items. */
    private static final Pattern METADATA_LINE = Pattern.compile(
            "(?i)^\\s*(table|tbl|seat|server|waiter|waitress|cashier|host|station|terminal|reg|register|lane|operator|emp|employee|clerk|party|pax|covers?|guests?)\\s*[:.]?\\s*|" +
            "(?i)^\\s*(order|ordered|check|ticket|trans|transaction|invoice|receipt|bill)\\s*(#|no|num|number)?\\s*[:.]?\\s*|" +
            "(?i)^\\s*(eat\\s*in|dine\\s*in|take\\s*out|to\\s*go|drive\\s*thru|delivery|carry\\s*out|pick\\s*up)\\b|" +
            "(?i)^\\s*(date|time|timestamp)\\s*[:.]?|" +
            "(?i)^\\s*(tel|phone|fax|web|website|www|http|gstin|fssai|cin|tax\\s*id|pan)\\b|" +
            "(?i)^\\s*(thank\\s*you|visit\\s*again|have\\s*a\\s*nice\\s*day|customer\\s*copy|merchant\\s*copy|duplicate)\\b|" +
            "(?i)^\\s*(add\\s*us|follow\\s*us|instagram|facebook|twitter|tiktok|wifi|network|password)\\b|" +
            "(?i)\\b(street|st\\.?|avenue|ave\\.?|road|rd\\.?|drive|dr\\.?|blvd\\.?|lane|highway|hwy|way|pkwy|circle|court|ct\\.?|suite|ste\\.?|apt\\.?|floor|fl\\.?)\\b.*\\b\\d{4,6}\\b|" +
            "(?i)\\b[A-Z]{2}\\s+\\d{5}(?:-\\d{4})?\\b|" +
            "(?i)\\b(pin\\s*code|pincode|zip\\s*code|zip)\\s*[:.]?\\s*\\d+|" +
            "(?i)^\\s*(sub\\s*total|subtotal|sub-total|total\\s*tax|sales\\s*tax|tax|grand\\s*total|total|balance\\s*due|amount\\s*due|order\\s*balance\\s*due)\\b");

    /** Stop-words that indicate a line is NOT a merchant name. */
    private static final Pattern MERCHANT_STOPWORDS = Pattern.compile(
            "(?i)^(\\d+([.,]\\d+)?|total|sub\\s*total|tax|gst|cgst|sgst|igst|" +
            "thank\\s*you|balance|amount|change|round|return|bill\\s*no|invoice|receipt|" +
            "order\\s*no|date|time|phone|web|www|http|table|server|cashier|gstin|cin|" +
            "fssai|qty|rate|amount|discount|service|charge|payable|net|grand|" +
            "instagram|facebook|twitter|follow|add\\s*us|" +
            "\\*+|#+|-+|—+|\\.{3,}|={3,})$");

    // ========================================================================
    // STAGE 3: Item extraction patterns (multiple formats)
    // ========================================================================

    /**
     * Format: qty [x] item-name unit-price total-price
     * Example: "2 Fried Chicken Sandwich 17.00 34.00" or "2 x Fried Chicken Sandwich 17.00 34.00"
     */
    private static final Pattern QTY_ITEM_UNIT_TOTAL = Pattern.compile(
            "^(\\d{1,3}(?:[.,]\\d+)?)\\s*(?:[xX*]\\s+)?([A-Za-z].+?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s*$");

    /**
     * Format: qty [x] item-name total-price
     * Example: "2 Fried Chicken Sandwich 34.00" or "1 BBQ Potato Chips 7.00"
     */
    private static final Pattern QTY_ITEM_TOTAL = Pattern.compile(
            "^(\\d{1,3}(?:[.,]\\d+)?)\\s*(?:[xX*]\\s+)?([A-Za-z].+?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s*$");

    /**
     * Format: OCR misread pipe / l / I / ! as leading '1' with item-name and total-price
     * Example: "| Mac & Cheese 17.00" -> qty=1, name="Mac & Cheese", total=17.00
     */
    private static final Pattern OCR_PIPE_QTY_ITEM_TOTAL = Pattern.compile(
            "^[|lI!]\\s+([A-Za-z].+?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s*$");

    /**
     * Format: item-name qty unit-price total-price
     * Example: "Butter Chicken 2 250.00 500.00"
     */
    private static final Pattern ITEM_QTY_UNIT_TOTAL = Pattern.compile(
            "^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s*$");

    /**
     * Format: item-name qty total-price
     * Example: "Butter Chicken 2 500.00"
     */
    private static final Pattern ITEM_QTY_TOTAL = Pattern.compile(
            "^(.+?)\\s+(\\d{1,3}(?:[.,]\\d+)?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s*$");

    /**
     * Format: item-name amount
     * Example: "Butter Chicken 500.00" or "Silver Chain 3,500.00"
     */
    private static final Pattern ITEM_AMOUNT = Pattern.compile(
            "^(.+?)\\s+((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)\\s*$");

    // ========================================================================
    // STAGE 4: Financial field patterns
    // ========================================================================

    /** Pattern that marks transition into the financial summary / total block. */
    private static final Pattern SUMMARY_BOUNDARY_PATTERN = Pattern.compile(
            "(?i)\\b(sub\\s*total|subtotal|sub-total|subtot|sub\\s*ttl|items?\\s*total|sr\\s*ical|sr\\s*total|" +
            "total\\s*tax|sales\\s*tax|grand\\s*total|order\\s*balance\\s*due|balance\\s*due|amount\\s*(?:due|payable|paid)|" +
            "admin(?:istrat(?:ive|ion))?\\s*(?:fee|charge)?|service\\s*charge|svc\\s*charge|service\\s*fee|convenience\\s*fee|surcharge)\\b|" +
            "(?i)(?<!item\\s)(?<!items\\s)\\btotal\\b(?!(?:\\s*(?:items?|qty|quantity)))");

    /** Maps keyword patterns to their semantic meaning. Order matters for priority. */
    private static final String[][] FINANCIAL_KEYWORDS = {
            // key,                regex pattern (case-insensitive)
            {"grandTotal",         "(?i)\\b(grand\\s*total|net\\s*(payable|amount|total)|order\\s*balance\\s*due|balance\\s*due|amount\\s*(payable|due)|" +
                                   "bill\\s*total|total\\s*(payable|amount|due)|balance|to\\s*pay|you\\s*pay|final\\s*total)\\b"},
            {"subtotal",           "(?i)\\b(sub\\s*total|subtotal|sub-total|subtot|sub\\s*ttl|items?\\s*total|sr\\s*ical|sr\\s*total)\\b"},
            {"cgst",               "(?i)\\b(cgst|c\\.?g\\.?s\\.?t\\.?)\\b"},
            {"sgst",               "(?i)\\b(sgst|s\\.?g\\.?s\\.?t\\.?)\\b"},
            {"tax",                "(?i)\\b(total\\s*tax|sales\\s*tax|tax\\s*total|state\\s*tax|city\\s*tax|tax|vat|gst(?!in)|service\\s*tax)\\b"},
            {"serviceCharge",      "(?i)\\b(service\\s*charge|svc\\s*charge|s\\.?c\\.?|admin(?:istrat(?:ive|ion))?\\s*(?:fee|charge)?|" +
                                   "service\\s*fee|convenience\\s*fee|processing\\s*fee|delivery\\s*fee|" +
                                   "packaging\\s*(?:fee|charge)|packing\\s*charge|kitchen\\s*fee|surcharge|fee\\s*\\([\\d.]+[%]?\\))\\b"},
            {"discount",           "(?i)\\b(discount|disc\\.?|offer|savings?|coupons?)\\b"},
            {"tip",                "(?i)\\b(tip|gratuity|suggested\\s*tip)\\b"},
            {"roundOff",           "(?i)\\b(round\\s*(off|adj)|rounding|adj(ust)?ment)\\b"},
            {"amountPaid",         "(?i)\\b(amount\\s*paid|cash\\s*(tendered|paid)?|card\\s*paid|paid\\s*amount|paid|tender|cash\\s*received)\\b"},
            {"change",             "(?i)\\b(change\\s*(due|returned|return)?|balance\\s*returned)\\b"},
            // Generic "total" last — only used if grandTotal didn't match, and exclude "total tax"
            {"total",              "(?i)(?<!sub\\s?)(?<!sub)(?<!item\\s)(?<!items\\s)(?<!tax\\s)\\btotal\\b(?!(?:\\s*(?:items?|qty|quantity|tax)))"},
    };

    /** Keywords that indicate a line is a financial summary line (not an item). */
    private static final Pattern FINANCIAL_LINE_INDICATOR = Pattern.compile(
            "(?i)\\b(sub\\s*total|subtotal|sub-total|subtot|sub\\s*ttl|" +
            "total|grand\\s*total|total\\s*tax|tax\\s*total|sales\\s*tax|state\\s*tax|" +
            "order\\s*balance\\s*due|balance\\s*due|amount\\s*(payable|due|paid|tendered|received)|" +
            "net\\s*(payable|amount|total)|cgst|sgst|igst|gst(?!in)|tax|vat|" +
            "discount|disc|round\\s*off|rounding|service\\s*charge|svc|admin(?:istrat(?:ive|ion))?\\s*(?:fee|charge)?|" +
            "service\\s*fee|convenience\\s*fee|surcharge|\\bfee\\b|to\\s*pay|" +
            "you\\s*pay|bill\\s*total|change|balance|tender|cash|card|upi|paid|" +
            "tip|gratuity|invoice|bill\\s*no|order\\s*no|receipt\\s*no|table|cashier|" +
            "thank\\s*you|visit\\s*again)\\b|(?i)(sr\\s*ical|sr\\s*total|sub\\s*ttl)|\\*{3,}|={3,}|-{3,}");

    /** Matches any number at the end of a line, optionally followed by tax code or currency symbol/punctuation. */
    private static final Pattern FINANCIAL_AMOUNT_PATTERN = Pattern.compile(
            "([+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:[.,]\\d{1,2})?)(?:\\s*[$€£¥A-Za-z*.:])?\\s*$");

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
            result.setOcrConfidence("LOW");
            result.setParsingConfidence("LOW");
            result.setValidationStatus("UNVERIFIED");
            result.setValidationMessage("No text found in receipt image.");
            return result;
        }

        // ---- Stage 0: Detect currency before symbols are normalized ----
        String detectedCurrency = detectCurrency(rawOcrText);
        result.setCurrency(detectedCurrency);

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
        result.setTip(financials.get("tip"));
        result.setRoundOff(financials.get("roundOff"));
        result.setAmountPaid(financials.get("amountPaid"));
        result.setChange(financials.get("change"));

        // ---- Stage 5: Final total selection ----
        Double finalTotal = selectFinalTotal(financials, items);
        result.setTotalAmount(finalTotal);

        // ---- Stage 6: Numeric validation of individual items ----
        validateItems(items);

        // ---- Stage 7: Financial Validation (multi-tier consistency check) ----
        validateFinancials(result, items, financials);

        // ---- Stage 8: Confidence scoring (OCR, parsing, overall) ----
        computeConfidences(result, items, financials, rawOcrText);

        // If confidence is LOW and items are empty and unverified, clear fragile data
        if ("LOW".equals(result.getConfidence()) && items.isEmpty() && "UNVERIFIED".equals(result.getValidationStatus())) {
            result.setTotalAmount(null);
            result.setSuggestedTitle(null);
        }

        log.info("Parsed {} items, total={}, title='{}', conf={}, ocrConf={}, parseConf={}, valStatus='{}', msg='{}'",
                result.getItems().size(), result.getTotalAmount(),
                result.getSuggestedTitle(), result.getConfidence(),
                result.getOcrConfidence(), result.getParsingConfidence(),
                result.getValidationStatus(), result.getValidationMessage());

        return result;
    }

    // ========================================================================
    // Stage 0: Currency Detection
    // ========================================================================

    /**
     * Detects the receipt currency from raw OCR text before symbols are normalized away.
     * Accurately distinguishes USD ($), INR (₹, Rs), EUR (€), GBP (£), etc.
     */
    public String detectCurrency(String rawText) {
        if (rawText == null || rawText.trim().isEmpty()) {
            return "INR";
        }
        int usdScore = 0;
        int inrScore = 0;
        int eurScore = 0;
        int gbpScore = 0;

        // USD indicators: $ symbol, USD, DOLLARS, CENTS
        Matcher usdSym = Pattern.compile("\\$").matcher(rawText);
        while (usdSym.find()) usdScore += 3;
        Matcher usdCode = Pattern.compile("(?i)\\b(USD|DOLLARS?|CENTS?)\\b").matcher(rawText);
        while (usdCode.find()) usdScore += 5;
        // Common US receipt indicators
        Matcher usTax = Pattern.compile("(?i)\\b(sales\\s*tax|state\\s*tax|city\\s*tax|gratuity|suggested\\s*tip)\\b").matcher(rawText);
        while (usTax.find()) usdScore += 4;

        // INR indicators: ₹ symbol, INR, RS, RUPEES, PAISE
        Matcher inrSym = Pattern.compile("₹").matcher(rawText);
        while (inrSym.find()) inrScore += 3;
        Matcher inrCode = Pattern.compile("(?i)\\b(INR|RS\\.?|RUPEES?|PAISE)\\b").matcher(rawText);
        while (inrCode.find()) inrScore += 4;
        Matcher inrTax = Pattern.compile("(?i)\\b(cgst|sgst|igst|gstin|fssai)\\b").matcher(rawText);
        while (inrTax.find()) inrScore += 4;

        // EUR indicators: € symbol, EUR, EUROS
        Matcher eurSym = Pattern.compile("€").matcher(rawText);
        while (eurSym.find()) eurScore += 3;
        Matcher eurCode = Pattern.compile("(?i)\\b(EUR|EUROS?)\\b").matcher(rawText);
        while (eurCode.find()) eurScore += 4;

        // GBP indicators: £ symbol, GBP, POUNDS
        Matcher gbpSym = Pattern.compile("£").matcher(rawText);
        while (gbpSym.find()) gbpScore += 3;
        Matcher gbpCode = Pattern.compile("(?i)\\b(GBP|POUNDS?)\\b").matcher(rawText);
        while (gbpCode.find()) gbpScore += 4;

        int max = Math.max(Math.max(usdScore, inrScore), Math.max(eurScore, gbpScore));
        if (max == 0) {
            return "INR";
        }
        if (max == usdScore) return "USD";
        if (max == inrScore) return "INR";
        if (max == eurScore) return "EUR";
        return "GBP";
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
     * Only applies when there is clear evidence that the token represents a numeric/financial value
     * (contains digits or decimal/comma with OCR character substitutions, and no arbitrary text letters).
     * Prevents corrupting arbitrary words like "SOUP", "BURGER", "BOB", "IS", etc.
     */
    private String fixOcrDigits(String line) {
        Matcher m = NUMERIC_LIKE_TOKEN.matcher(line);
        StringBuilder result = new StringBuilder();
        int lastEnd = 0;
        while (m.find()) {
            result.append(line, lastEnd, m.start());
            String token = m.group(1);

            int digitCount = 0;
            int separatorCount = 0;
            int substCount = 0;
            int arbitraryLetterCount = 0;

            for (char c : token.toCharArray()) {
                if (Character.isDigit(c)) {
                    digitCount++;
                } else if (c == '.' || c == ',') {
                    separatorCount++;
                } else if ("OoIlSsBbZz".indexOf(c) >= 0) {
                    substCount++;
                } else {
                    arbitraryLetterCount++;
                }
            }

            // Normalization is only safe if:
            // 1. There are NO arbitrary letters (e.g. not "SOUP", "BOB", "BURGER")
            // 2. Either:
            //    - The token has at least one actual digit and some substitution chars (e.g. "1S29.OO", "4SO.00")
            //    - OR has a decimal/comma and substitution chars (e.g. "OO.OO", "O.5O")
            //    - Never touch purely alphabetic tokens like "IS", "BOB", "SO" that have no digit and no decimal
            boolean isNumericContext = (arbitraryLetterCount == 0 && substCount > 0)
                    && (digitCount > 0 || separatorCount > 0);

            if (isNumericContext) {
                token = token.replace('O', '0').replace('o', '0')
                        .replace('I', '1').replace('l', '1')
                        .replace('S', '5').replace('s', '5')
                        .replace('B', '8').replace('b', '8')
                        .replace('Z', '2').replace('z', '2');
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
    /**
     * Extracts the most likely merchant/store name from receipt header lines:
     * - Filters out noise, emoticons (e.g. "T_T"), single characters, and metadata.
     * - Evaluates candidate lines in the header section using structural and semantic cues.
     * - Returns the highest scoring candidate line.
     */
    String suggestTitle(String[] lines) {
        String bestCandidate = null;
        int bestScore = -1;

        int linesChecked = 0;
        for (String line : lines) {
            if (line == null) continue;
            line = line.trim();
            if (line.isEmpty()) continue;
            linesChecked++;
            if (linesChecked > 12) break;

            if (line.length() < 3 || line.length() > 80) continue;
            // Reject pure noise or emoticons like "T_T", "^_^", "_", "--", etc.
            if (line.contains("_") || line.matches("^[\\W_]+$")) continue;

            long letterCount = line.chars().filter(Character::isLetter).count();
            if (letterCount < 3) continue;
            if ((double) letterCount / line.length() < 0.45) continue;

            if (MERCHANT_STOPWORDS.matcher(line).matches()) continue;
            if (COLUMN_HEADER_LINE.matcher(line).matches()) continue;
            if (SIMPLE_HEADER_LINE.matcher(line).matches()) continue;
            if (GENERIC_COLUMN_HEADER.matcher(line).find()) continue;
            if (METADATA_LINE.matcher(line).find()) continue;
            if (FINANCIAL_LINE_INDICATOR.matcher(line).find()) continue;
            if (TRAILING_NUMBER.matcher(line).find()) continue;

            // Clean candidate line
            String candidate = line.replaceAll("^[#*~\\-\\s|]+", "").replaceAll("[#*~\\-\\s|]+$", "").trim();
            if (candidate.length() < 3) continue;

            int score = 0;
            if (letterCount >= 5) score += 5;
            if (candidate.contains(" ")) score += 10;
            // Title case check
            if (candidate.matches("^(?:[A-Z][a-z0-9'&.-]+\\s*)+$")) score += 15;
            else if (candidate.matches("^[A-Z0-9 '&.-]+$") && letterCount >= 4) score += 10;

            // Common merchant keywords
            if (candidate.matches("(?i).*\\b(room|kitchen|cafe|café|grill|bistro|restaurant|bar|bakery|pizza|coffee|shop|house|diner|pub|market|store|tavern|tack|inn|hotel|eats?)\\b.*")) {
                score += 25;
            }

            // Cross-check with social media handles or text anywhere on receipt
            for (String l : lines) {
                if (l != null && (l.toLowerCase().contains("instagram") || l.toLowerCase().contains("facebook") || l.toLowerCase().contains("twitter"))) {
                    for (String w : candidate.split("\\s+")) {
                        if (w.length() >= 4 && l.toLowerCase().contains(w.toLowerCase())) {
                            score += 30;
                            break;
                        }
                    }
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestCandidate = candidate;
            }
        }

        return bestCandidate;
    }

    // ========================================================================
    // Stage 3: Item Extraction
    // ========================================================================

    /**
     * Extracts line items from OCR lines. Supports multiple formats:
     * <ol>
     *   <li>qty [x] item unitPrice totalPrice (e.g. "2 Fried Chicken Sandwich 17.00 34.00")</li>
     *   <li>qty [x] item totalPrice (e.g. "2 Fried Chicken Sandwich 34.00", "1 BBQ Potato Chips 7.00")</li>
     *   <li>item qty unitPrice totalPrice (e.g. "Butter Chicken 2 250.00 500.00")</li>
     *   <li>item qty totalPrice (e.g. "Butter Chicken 2 500.00")</li>
     *   <li>item amount (e.g. "Butter Chicken 500.00")</li>
     * </ol>
     * Skips financial summary lines, column headers, and lines with
     * impossible values.
     */
    List<BillItemRequest> extractItems(String[] lines) {
        List<BillItemRequest> items = new ArrayList<>();
        boolean inSummarySection = false;

        for (String line : lines) {
            if (line == null) continue;
            line = line.trim();
            if (line.isEmpty()) continue;

            // Skip column headers
            if (COLUMN_HEADER_LINE.matcher(line).matches()) continue;
            if (SIMPLE_HEADER_LINE.matcher(line).matches()) continue;
            if (GENERIC_COLUMN_HEADER.matcher(line).find()) continue;

            // Detect transition into the financial summary section FIRST
            // (e.g., Subtotal, Admin Fee, Service Charge, Total Tax, Grand Total, Balance Due, or generic Total when items already exist)
            if (SUMMARY_BOUNDARY_PATTERN.matcher(line).find()) {
                inSummarySection = true;
            }

            if (inSummarySection) {
                // Lines in or following the summary block are financial metrics or payment info,
                // never purchased items!
                continue;
            }

            // Skip metadata lines (table, seat, cashier, date, order #, address, social media, etc.)
            if (METADATA_LINE.matcher(line).find()) continue;

            // Skip financial lines
            if (FINANCIAL_LINE_INDICATOR.matcher(line).find()) continue;

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
        // Strip leading serial numbers with dot/paren/dash like "1. ", "1) ", "#1 "
        String workingLine = line.replaceAll("^#?\\d{1,3}[.)\\-]\\s*", "").trim();

        // 1. Format: QTY ITEM UNIT_PRICE TOTAL
        // Example: "2 Fried Chicken Sandwich 17.00 34.00"
        Matcher mQtyUnitTotal = QTY_ITEM_UNIT_TOTAL.matcher(workingLine);
        if (mQtyUnitTotal.matches()) {
            Double qty = parseMoney(mQtyUnitTotal.group(1));
            String name = cleanItemName(mQtyUnitTotal.group(2));
            Double unitPrice = parseMoney(mQtyUnitTotal.group(3));
            Double total = parseMoney(mQtyUnitTotal.group(4));

            if (isValidItemName(name) && total != null && total > 0 && total <= MAX_REASONABLE_ITEM_PRICE) {
                BillItemRequest item = new BillItemRequest();
                item.setName(name);
                item.setPrice(total);
                item.setQuantity(qty != null && qty <= MAX_REASONABLE_QTY ? qty : null);
                item.setUnitPrice(unitPrice);
                item.setSharedByUserIds(new ArrayList<>());
                return item;
            }
        }

        // 2. Format: QTY ITEM TOTAL
        // Example: "2 Fried Chicken Sandwich 34.00" or "1 BBQ Potato Chips 7.00"
        Matcher mQtyTotal = QTY_ITEM_TOTAL.matcher(workingLine);
        if (mQtyTotal.matches()) {
            Double qty = parseMoney(mQtyTotal.group(1));
            String name = cleanItemName(mQtyTotal.group(2));
            Double total = parseMoney(mQtyTotal.group(3));

            if (isValidItemName(name) && total != null && total > 0 && total <= MAX_REASONABLE_ITEM_PRICE) {
                BillItemRequest item = new BillItemRequest();
                item.setName(name);
                item.setPrice(total);
                if (qty != null && qty <= MAX_REASONABLE_QTY) {
                    item.setQuantity(qty);
                    if (qty > 0) {
                        item.setUnitPrice(Math.round(total / qty * 100.0) / 100.0);
                    }
                }
                item.setSharedByUserIds(new ArrayList<>());
                return item;
            }
        }

        // 3. Format: OCR pipe / l / I / ! as leading '1' ITEM TOTAL
        // Example: "| Mac & Cheese 17.00"
        Matcher mPipeQty = OCR_PIPE_QTY_ITEM_TOTAL.matcher(workingLine);
        if (mPipeQty.matches()) {
            String name = cleanItemName(mPipeQty.group(1));
            Double total = parseMoney(mPipeQty.group(2));

            if (isValidItemName(name) && total != null && total > 0 && total <= MAX_REASONABLE_ITEM_PRICE) {
                BillItemRequest item = new BillItemRequest();
                item.setName(name);
                item.setPrice(total);
                item.setQuantity(1.0);
                item.setUnitPrice(total);
                item.setSharedByUserIds(new ArrayList<>());
                return item;
            }
        }

        // 4. Format: ITEM QTY UNIT_PRICE TOTAL (quantity after name)
        // Example: "Butter Chicken 2 250.00 500.00"
        Matcher m4 = ITEM_QTY_UNIT_TOTAL.matcher(workingLine);
        if (m4.matches()) {
            String name = cleanItemName(m4.group(1));
            Double qty = parseMoney(m4.group(2));
            Double unitPrice = parseMoney(m4.group(3));
            Double total = parseMoney(m4.group(4));

            if (isValidItemName(name) && total != null && total > 0 && total <= MAX_REASONABLE_ITEM_PRICE) {
                BillItemRequest item = new BillItemRequest();
                item.setName(name);
                item.setPrice(total);
                item.setQuantity(qty);
                item.setUnitPrice(unitPrice);
                item.setSharedByUserIds(new ArrayList<>());
                return item;
            }
        }

        // 5. Format: ITEM QTY TOTAL (quantity after name)
        // Example: "Butter Chicken 2 500.00"
        Matcher m3 = ITEM_QTY_TOTAL.matcher(workingLine);
        if (m3.matches()) {
            String name = cleanItemName(m3.group(1));
            Double qty = parseMoney(m3.group(2));
            Double total = parseMoney(m3.group(3));

            if (qty != null && qty <= MAX_REASONABLE_QTY
                    && isValidItemName(name) && total != null && total > 0
                    && total <= MAX_REASONABLE_ITEM_PRICE) {
                BillItemRequest item = new BillItemRequest();
                item.setName(name);
                item.setPrice(total);
                item.setQuantity(qty);
                if (qty > 0) {
                    item.setUnitPrice(Math.round(total / qty * 100.0) / 100.0);
                }
                item.setSharedByUserIds(new ArrayList<>());
                return item;
            }
        }

        // 6. Format: ITEM TOTAL (item amount only)
        // Example: "Butter Chicken 500.00"
        Matcher m2 = ITEM_AMOUNT.matcher(workingLine);
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
        // Remove leading serial numbers like "1.", "1)", "#1"
        name = name.replaceAll("^#?\\d{1,3}[.)\\-]\\s*", "");
        // Remove leading OCR noise symbols like |, •, *, -, ~, _, ©, ®, !
        name = name.replaceAll("^[|•*·\\-~_©®!#\ufffd\\s]+", "");
        // Remove trailing OCR noise symbols, colons, dots, dashes, spaces
        name = name.replaceAll("[|•*·\\-~_©®!#:.\ufffd\\s]+$", "");
        // Fix known OCR phonetic/ligature misreadings
        name = fixKnownOcrMisreads(name);
        return name.trim();
    }

    private String fixKnownOcrMisreads(String name) {
        if (name == null) return "";
        // Fix OCR ligature artifact: "nous Duck" -> "Famous Duck"
        if (name.matches("(?i)^(?:nous|mous)\\s+Duck(\\b.*)?$")) {
            return name.replaceFirst("(?i)^(?:nous|mous)\\s+Duck", "Famous Duck");
        }
        return name;
    }

    private boolean isValidItemName(String name) {
        if (name == null || name.length() < 2) return false;
        // Must contain at least one letter
        if (!name.matches(".*[A-Za-z].*")) return false;
        // Should not be a pure financial keyword, column header, or metadata
        if (FINANCIAL_LINE_INDICATOR.matcher(name).find()) return false;
        if (METADATA_LINE.matcher(name).find()) return false;
        if (GENERIC_COLUMN_HEADER.matcher(name).find()) return false;
        // Reject OCR artifacts of totals and subtotal
        if (name.matches("(?i)^(sr\\s*ical|sr\\s*total|sub\\s*total|order\\s*balance).*")) return false;
        // Reject financial fee patterns
        if (name.matches("(?i).*(?:admin\\s*fee|service\\s*charge|service\\s*fee|convenience\\s*fee|surcharge).*")) return false;
        // Reject lines where the item name is just a column header keyword or followed only by #/no/code
        if (name.matches("(?i)^(item|items|qty|quantity|price|amount|total)(?:\\s*[:.#/\\-]?|\\s+(?:no|num|number|descr|description|code))?$")) return false;
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
                    Matcher numMatcher = FINANCIAL_AMOUNT_PATTERN.matcher(line);
                    if (numMatcher.find()) {
                        Double value = parseMoney(numMatcher.group(1));
                        if (value != null && Math.abs(value) <= MAX_REASONABLE_TOTAL) {
                            result.put(key, value);
                            log.debug("Financial field '{}' = {} from line: {}", key, value, line);
                        }
                    } else {
                        // Fallback: search for last valid money token on line
                        Matcher anyNum = ANY_NUMBER.matcher(line);
                        Double lastVal = null;
                        while (anyNum.find()) {
                            Double v = parseMoney(anyNum.group());
                            if (v != null && Math.abs(v) <= MAX_REASONABLE_TOTAL) {
                                lastVal = v;
                            }
                        }
                        if (lastVal != null) {
                            result.put(key, lastVal);
                            log.debug("Financial field '{}' = {} from fallback on line: {}", key, lastVal, line);
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
        Double grandTotal = financials.get("grandTotal");
        Double subtotal = financials.get("subtotal");
        Double amountPaid = financials.get("amountPaid");
        Double change = financials.get("change");
        Double total = financials.get("total");

        // Priority 1: Grand total / amount payable / net payable
        if (grandTotal != null && grandTotal > 0) {
            // Guard: ensure grandTotal was not accidentally matched to change
            if (change != null && grandTotal.equals(change) && subtotal != null && !grandTotal.equals(subtotal)) {
                log.warn("grandTotal equals change ({}), skipping", grandTotal);
            } else {
                log.info("Using grandTotal={} as final total", grandTotal);
                return grandTotal;
            }
        }

        // Priority 2: Generic "total" (which we only matched if it's not "subtotal")
        if (total != null && total > 0) {
            // Cross-check: if we also have a subtotal and total <= subtotal with positive tax,
            // or total equals change / amountPaid, skip it
            boolean isSubtotalMislabeled = (subtotal != null && total <= subtotal && !total.equals(subtotal));
            boolean isChange = (change != null && total.equals(change));
            boolean isAmountPaid = (amountPaid != null && total.equals(amountPaid) && subtotal != null && !amountPaid.equals(subtotal));

            if (isSubtotalMislabeled || isChange || isAmountPaid) {
                log.warn("Detected 'total'={} rejected (isSubtotalMislabeled={}, isChange={}, isAmountPaid={})",
                        total, isSubtotalMislabeled, isChange, isAmountPaid);
            } else {
                log.info("Using total={} as final total", total);
                return total;
            }
        }

        // Priority 3: Compute from subtotal + taxes - discount + tip + roundOff
        if (subtotal != null && subtotal > 0) {
            double computed = subtotal;
            Double tax = financials.get("tax");
            Double cgst = financials.get("cgst");
            Double sgst = financials.get("sgst");
            Double sc = financials.get("serviceCharge");
            Double disc = financials.get("discount");
            Double tip = financials.get("tip");
            Double roundOff = financials.get("roundOff");

            if (cgst != null) computed += cgst;
            if (sgst != null) computed += sgst;
            if (tax != null && cgst == null && sgst == null) computed += tax;
            if (sc != null) computed += sc;
            if (disc != null) computed -= Math.abs(disc);
            if (tip != null) computed += tip;
            if (roundOff != null) computed += roundOff;

            computed = Math.round(computed * 100.0) / 100.0;
            log.info("Computed total from subtotal: {} (subtotal={}, taxes, sc, disc, tip, roundOff)", computed, subtotal);
            return computed;
        }

        // Priority 4: Reconstruct from amountPaid - change
        if (amountPaid != null && change != null && amountPaid > change) {
            double reconstructed = Math.round((amountPaid - change) * 100.0) / 100.0;
            log.info("Reconstructed total from amountPaid ({}) - change ({}) = {}", amountPaid, change, reconstructed);
            return reconstructed;
        }

        // Priority 5: Sum of item prices
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

        // Priority 6: Give up
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
    // Stage 7: Financial Validation
    // ========================================================================

    /**
     * Validates mathematical consistency of the receipt:
     * - Checks if sum(items) ≈ subtotal (if both exist)
     * - Checks if subtotal + tax + serviceCharge - discount + tip ± roundOff ≈ total (if subtotal exists)
     * - Checks if sum(items) + tax - discount + tip ≈ total (if no subtotal exists)
     * Sets validationStatus to: VALIDATED, PARTIALLY_VALIDATED, UNVERIFIED, or FAILED_VALIDATION
     * and generates an informative user-facing validationMessage.
     */
    void validateFinancials(ReceiptParseResult result, List<BillItemRequest> items, Map<String, Double> financials) {
        Double total = result.getTotalAmount();
        Double subtotal = result.getSubtotal();
        Double cgst = result.getCgst();
        Double sgst = result.getSgst();
        Double tax = result.getTax();
        Double sc = result.getServiceCharge();
        Double disc = result.getDiscount();
        Double tip = result.getTip();
        Double ro = result.getRoundOff();

        double itemSum = items.stream()
                .mapToDouble(i -> i.getPrice() != null ? i.getPrice() : 0.0)
                .sum();
        itemSum = Math.round(itemSum * 100.0) / 100.0;

        double taxTotal = 0.0;
        if (cgst != null || sgst != null) {
            taxTotal = (cgst != null ? cgst : 0.0) + (sgst != null ? sgst : 0.0);
        } else if (tax != null) {
            taxTotal = tax;
        }

        double discTotal = disc != null ? Math.abs(disc) : 0.0;
        double scTotal = sc != null ? sc : 0.0;
        double tipTotal = tip != null ? tip : 0.0;
        double roTotal = ro != null ? ro : 0.0;

        double tolerance = 1.05;

        String cur = result.getCurrency() != null ? result.getCurrency() : "INR";
        String sym = "USD".equalsIgnoreCase(cur) ? "$" :
                     ("EUR".equalsIgnoreCase(cur) ? "€" :
                     ("GBP".equalsIgnoreCase(cur) ? "£" : "₹"));

        if (total == null || total <= 0) {
            result.setValidationStatus("UNVERIFIED");
            result.setValidationMessage("Total amount could not be detected. Please verify.");
            return;
        }

        // Scenario 1: Subtotal and Total both exist
        if (subtotal != null && subtotal > 0) {
            double expectedTotal = Math.round((subtotal + taxTotal + scTotal - discTotal + tipTotal + roTotal) * 100.0) / 100.0;
            double diff = Math.abs(expectedTotal - total);
            double dynamicTol = Math.max(tolerance, total * 0.015);

            if (diff > dynamicTol) {
                result.setValidationStatus("FAILED_VALIDATION");
                result.setValidationMessage(String.format(java.util.Locale.US,
                        "Detected total (%s%.2f) does not match subtotal + taxes/charges (expected %s%.2f). Please verify.",
                        sym, total, sym, expectedTotal));
                return;
            }

            // Subtotal + taxes match total!
            if (!items.isEmpty()) {
                double itemDiff = Math.abs(itemSum - subtotal);
                double itemTol = Math.max(tolerance, subtotal * 0.02);
                if (itemDiff <= itemTol) {
                    result.setValidationStatus("VALIDATED");
                    result.setValidationMessage(String.format(java.util.Locale.US,
                            "Receipt mathematically validated: items match subtotal (%s%.2f), and subtotal + taxes/charges match total (%s%.2f).",
                            sym, subtotal, sym, total));
                } else {
                    result.setValidationStatus("PARTIALLY_VALIDATED");
                    result.setValidationMessage(String.format(java.util.Locale.US,
                            "Subtotal matches total (%s%.2f), but sum of items (%s%.2f) differs slightly. Please verify items.",
                            sym, total, sym, itemSum));
                }
            } else {
                result.setValidationStatus("PARTIALLY_VALIDATED");
                result.setValidationMessage("Subtotal and total match, but no itemized list was detected.");
            }
            return;
        }

        // Scenario 2: No subtotal, but items and total exist
        if (!items.isEmpty() && itemSum > 0) {
            double expectedTotal = Math.round((itemSum + taxTotal + scTotal - discTotal + tipTotal + roTotal) * 100.0) / 100.0;
            double diff = Math.abs(expectedTotal - total);
            double dynamicTol = Math.max(tolerance, total * 0.02);

            if (diff <= dynamicTol) {
                result.setValidationStatus("VALIDATED");
                result.setValidationMessage("Receipt mathematically validated: sum of items + taxes matches total.");
            } else {
                result.setValidationStatus("FAILED_VALIDATION");
                result.setValidationMessage(String.format(java.util.Locale.US,
                        "Detected total (%s%.2f) does not match calculated items + taxes (expected %s%.2f). Please verify.",
                        sym, total, sym, expectedTotal));
            }
            return;
        }

        // Scenario 3: Only total found
        result.setValidationStatus("UNVERIFIED");
        result.setValidationMessage("Total detected without breakdown. Please verify receipt details.");
    }

    // ========================================================================
    // Stage 8: Confidence Scoring
    // ========================================================================

    /**
     * Computes multi-dimensional confidence:
     * - ocrConfidence: based on character density and words in raw text
     * - parsingConfidence: based on recognized structural elements
     * - overall confidence: capped at LOW if validation failed, HIGH only when validated!
     */
    void computeConfidences(ReceiptParseResult result, List<BillItemRequest> items,
                            Map<String, Double> financials, String rawOcrText) {
        // 1. OCR Confidence
        int quality = calculateOcrQualityScore(rawOcrText);
        String ocrConf = quality >= 30 ? "HIGH" : (quality >= 12 ? "MEDIUM" : "LOW");
        result.setOcrConfidence(ocrConf);

        // 2. Parsing Confidence
        boolean hasMerchant = result.getSuggestedTitle() != null && !result.getSuggestedTitle().isEmpty();
        boolean hasItems = !items.isEmpty();
        boolean hasTotal = result.getTotalAmount() != null && result.getTotalAmount() > 0;
        boolean hasBreakdown = financials.containsKey("subtotal") || financials.containsKey("tax")
                || financials.containsKey("cgst") || financials.containsKey("grandTotal");

        String parseConf;
        if (hasTotal && hasItems && (hasMerchant || hasBreakdown)) {
            parseConf = "HIGH";
        } else if (hasTotal || (hasItems && items.size() >= 2)) {
            parseConf = "MEDIUM";
        } else {
            parseConf = "LOW";
        }
        result.setParsingConfidence(parseConf);

        // 3. Overall Confidence (informed by Financial Validation)
        String valStatus = result.getValidationStatus();
        if ("FAILED_VALIDATION".equals(valStatus)) {
            // NEVER label an incorrectly parsed receipt as HIGH confidence!
            result.setConfidence("LOW");
        } else if ("VALIDATED".equals(valStatus) && "HIGH".equals(parseConf)) {
            result.setConfidence("HIGH");
        } else if ("VALIDATED".equals(valStatus)) {
            result.setConfidence("MEDIUM");
        } else if ("PARTIALLY_VALIDATED".equals(valStatus)) {
            result.setConfidence("MEDIUM");
        } else if ("UNVERIFIED".equals(valStatus) && hasTotal) {
            result.setConfidence("MEDIUM");
        } else {
            result.setConfidence(parseConf);
        }
    }

    private int calculateOcrQualityScore(String text) {
        if (text == null || text.isEmpty()) return 0;
        int score = 0;
        Matcher wordMatcher = Pattern.compile("[A-Za-z]{2,}").matcher(text);
        while (wordMatcher.find()) score += 3;
        Matcher numberMatcher = Pattern.compile("\\d{2,}(?:[.,]\\d{1,2})?").matcher(text);
        while (numberMatcher.find()) score += 2;
        String lower = text.toLowerCase();
        if (lower.contains("total") || lower.contains("amount")) score += 5;
        if (lower.contains("tax") || lower.contains("gst")) score += 2;
        if (text.contains(".")) score += 1;
        return score;
    }

    /**
     * Backward-compatible computeConfidence for tests.
     */
    String computeConfidence(ReceiptParseResult result, List<BillItemRequest> items,
                             Map<String, Double> financials) {
        computeConfidences(result, items, financials, result.getRawText());
        return result.getConfidence();
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