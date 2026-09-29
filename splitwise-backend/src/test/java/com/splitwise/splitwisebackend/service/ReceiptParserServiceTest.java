package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.dto.BillItemRequest;
import com.splitwise.splitwisebackend.dto.ReceiptParseResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link ReceiptParserService} covering the staged parsing
 * pipeline with representative OCR strings.
 */
class ReceiptParserServiceTest {

    private ReceiptParserService parser;

    @BeforeEach
    void setUp() {
        parser = new ReceiptParserService();
    }

    // ====================================================================
    // Clean receipt
    // ====================================================================
    @Nested
    @DisplayName("Clean Receipt")
    class CleanReceipt {

        @Test
        @DisplayName("Parses a clean, well-formatted receipt")
        void cleanReceipt() {
            String ocr = """
                    TAJ RESTAURANT
                    123 Food Street, Mumbai
                    Date: 2024-01-15
                    
                    Butter Chicken  2  250.00  500.00
                    Naan  4  40.00  160.00
                    Dal Makhani  1  180.00  180.00
                    Lassi  2  60.00  120.00
                    
                    Subtotal  960.00
                    CGST 2.5%  24.00
                    SGST 2.5%  24.00
                    
                    Grand Total  1008.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals("TAJ RESTAURANT", result.getSuggestedTitle());
            assertEquals(4, result.getItems().size());
            assertEquals(1008.00, result.getTotalAmount(), 0.01);
            assertEquals(960.00, result.getSubtotal(), 0.01);
            assertEquals(24.00, result.getCgst(), 0.01);
            assertEquals(24.00, result.getSgst(), 0.01);
            assertEquals("HIGH", result.getConfidence());

            // Verify individual items
            BillItemRequest chicken = result.getItems().get(0);
            assertEquals("Butter Chicken", chicken.getName());
            assertEquals(500.00, chicken.getPrice(), 0.01);
            assertEquals(2.0, chicken.getQuantity(), 0.01);
            assertEquals(250.00, chicken.getUnitPrice(), 0.01);
        }
    }

    // ====================================================================
    // OCR currency symbol corruption
    // ====================================================================
    @Nested
    @DisplayName("Currency Symbol Corruption")
    class CurrencyCorruption {

        @Test
        @DisplayName("Handles Rs. / ₹ / INR prefixes in amounts")
        void currencyPrefixes() {
            String ocr = """
                    CAFE DELIGHT
                    
                    Coffee Rs. 150.00
                    Sandwich Rs.250.00
                    
                    Total Rs. 400.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertTrue(result.getItems().size() >= 2,
                    "Should find at least 2 items; found " + result.getItems().size());
            assertEquals(400.00, result.getTotalAmount(), 0.01);
        }

        @Test
        @DisplayName("Handles INR prefix")
        void inrPrefix() {
            String ocr = """
                    SHOP NAME
                    
                    Item A INR 100.00
                    Item B INR 200.00
                    
                    Total INR 300.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);
            assertEquals(300.00, result.getTotalAmount(), 0.01);
        }
    }

    // ====================================================================
    // Subtotal + Tax + Grand Total
    // ====================================================================
    @Nested
    @DisplayName("Subtotal + Tax + Grand Total")
    class SubtotalTaxGrandTotal {

        @Test
        @DisplayName("Prefers Grand Total over Subtotal")
        void prefersGrandTotal() {
            String ocr = """
                    PIZZA HUT
                    
                    Margherita Pizza  350.00
                    Garlic Bread  150.00
                    Coke  60.00
                    
                    Subtotal  560.00
                    Tax  28.00
                    Grand Total  588.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(588.00, result.getTotalAmount(), 0.01,
                    "Should use Grand Total, not Subtotal");
            assertEquals(560.00, result.getSubtotal(), 0.01);
            assertEquals(28.00, result.getTax(), 0.01);
        }

        @Test
        @DisplayName("Uses AMOUNT PAYABLE as final total")
        void amountPayable() {
            String ocr = """
                    RESTAURANT XYZ
                    
                    Item One  200.00
                    Item Two  300.00
                    
                    Sub Total  500.00
                    CGST  25.00
                    SGST  25.00
                    Service Charge  50.00
                    Amount Payable  600.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(600.00, result.getTotalAmount(), 0.01);
            assertEquals(500.00, result.getSubtotal(), 0.01);
            assertEquals(25.00, result.getCgst(), 0.01);
            assertEquals(25.00, result.getSgst(), 0.01);
            assertEquals(50.00, result.getServiceCharge(), 0.01);
        }

        @Test
        @DisplayName("Computes total from subtotal + taxes when no grand total line exists")
        void computeFromSubtotalPlusTax() {
            String ocr = """
                    SMALL CAFE
                    
                    Tea  30.00
                    Biscuit  20.00
                    
                    Subtotal  50.00
                    CGST  2.50
                    SGST  2.50
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            // Should compute: 50 + 2.5 + 2.5 = 55
            assertEquals(55.00, result.getTotalAmount(), 0.01,
                    "Should compute total from subtotal + CGST + SGST");
        }
    }

    // ====================================================================
    // Multiple items
    // ====================================================================
    @Nested
    @DisplayName("Multiple Items")
    class MultipleItems {

        @Test
        @DisplayName("Extracts items in item-amount format")
        void itemAmountFormat() {
            String ocr = """
                    GROCERY STORE
                    
                    Rice 5kg  250.00
                    Sugar 1kg  45.00
                    Milk 1L  28.00
                    Bread  35.00
                    Eggs  72.00
                    
                    Total  430.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertTrue(result.getItems().size() >= 4,
                    "Should extract at least 4 items; found " + result.getItems().size());
            assertEquals(430.00, result.getTotalAmount(), 0.01);
        }

        @Test
        @DisplayName("Extracts items in qty-unit-total format")
        void qtyUnitTotalFormat() {
            String ocr = """
                    DINNER PLACE
                    
                    ITEM QTY RATE AMOUNT
                    Paneer Tikka  2  200.00  400.00
                    Roti  6  15.00  90.00
                    Raita  1  80.00  80.00
                    
                    Total  570.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(3, result.getItems().size());
            assertEquals(570.00, result.getTotalAmount(), 0.01);

            // Verify the header line was NOT treated as an item
            for (BillItemRequest item : result.getItems()) {
                assertNotEquals("ITEM", item.getName().toUpperCase().trim());
                assertNotEquals("ITEM QTY RATE AMOUNT", item.getName().toUpperCase().trim());
            }
        }
    }

    // ====================================================================
    // Duplicate-looking numbers
    // ====================================================================
    @Nested
    @DisplayName("Duplicate-looking Numbers")
    class DuplicateNumbers {

        @Test
        @DisplayName("Does not confuse subtotal with total when both are same value")
        void sameSubtotalAndTotal() {
            String ocr = """
                    SIMPLE SHOP
                    
                    Product A  100.00
                    Product B  100.00
                    
                    Subtotal  200.00
                    Total  200.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(200.00, result.getTotalAmount(), 0.01);
            assertEquals(200.00, result.getSubtotal(), 0.01);
        }

        @Test
        @DisplayName("When qty=1 and amount matches, treats as item correctly")
        void qtyOneMatches() {
            String ocr = """
                    STORE
                    
                    Widget  1  150.00  150.00
                    Gadget  1  250.00  250.00
                    
                    Total  400.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(2, result.getItems().size());
            assertEquals(400.00, result.getTotalAmount(), 0.01);
        }
    }

    // ====================================================================
    // No explicit subtotal
    // ====================================================================
    @Nested
    @DisplayName("No Explicit Subtotal")
    class NoSubtotal {

        @Test
        @DisplayName("Sums items when only Total line exists")
        void totalWithoutSubtotal() {
            String ocr = """
                    BAKERY SHOP
                    
                    Cake  450.00
                    Pastry  120.00
                    Cookie  80.00
                    
                    Total  650.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertNull(result.getSubtotal(), "No subtotal line, so subtotal should be null");
            assertEquals(650.00, result.getTotalAmount(), 0.01);
        }

        @Test
        @DisplayName("Falls back to item sum when no total line exists")
        void noTotalLine() {
            String ocr = """
                    STREET FOOD STALL
                    
                    Pani Puri  50.00
                    Samosa  30.00
                    Chai  20.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(100.00, result.getTotalAmount(), 0.01,
                    "Should fall back to item sum = 50+30+20 = 100");
        }
    }

    // ====================================================================
    // Discount receipt
    // ====================================================================
    @Nested
    @DisplayName("Discount Receipt")
    class DiscountReceipt {

        @Test
        @DisplayName("Extracts discount field")
        void discountExtracted() {
            String ocr = """
                    MEGA MART
                    
                    Shirt  1200.00
                    Jeans  1500.00
                    
                    Subtotal  2700.00
                    Discount  -270.00
                    
                    Grand Total  2430.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(2430.00, result.getTotalAmount(), 0.01);
            assertEquals(2700.00, result.getSubtotal(), 0.01);
            assertNotNull(result.getDiscount(), "Should extract discount");
        }
    }

    // ====================================================================
    // CGST/SGST receipt
    // ====================================================================
    @Nested
    @DisplayName("CGST/SGST Receipt")
    class CgstSgstReceipt {

        @Test
        @DisplayName("Extracts CGST and SGST separately")
        void cgstSgstSeparate() {
            String ocr = """
                    HOTEL GRAND
                    GSTIN: 27ABCDE1234F1Z5
                    
                    Room Service  1500.00
                    Mini Bar  800.00
                    
                    Subtotal  2300.00
                    CGST @9%  207.00
                    SGST @9%  207.00
                    
                    Total  2714.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(2714.00, result.getTotalAmount(), 0.01);
            assertEquals(2300.00, result.getSubtotal(), 0.01);
            assertEquals(207.00, result.getCgst(), 0.01);
            assertEquals(207.00, result.getSgst(), 0.01);
        }
    }

    // ====================================================================
    // Malformed numeric values from OCR
    // ====================================================================
    @Nested
    @DisplayName("Malformed OCR Numbers")
    class MalformedOcrNumbers {

        @Test
        @DisplayName("Handles thousands-separator commas")
        void thousandsSeparator() {
            String ocr = """
                    JEWELLERY STORE
                    
                    Gold Ring  25,000.00
                    Silver Chain  3,500.00
                    
                    Total  28,500.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(28500.00, result.getTotalAmount(), 0.01);
        }

        @Test
        @DisplayName("Handles comma as decimal separator")
        void commaDecimalSeparator() {
            String ocr = """
                    SHOP
                    
                    Item A  150,50
                    Item B  200,75
                    
                    Total  351,25
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(351.25, result.getTotalAmount(), 0.01);
        }

        @Test
        @DisplayName("Null/empty input returns LOW confidence")
        void nullInput() {
            ReceiptParseResult result = parser.parseReceiptText(null);
            assertEquals("LOW", result.getConfidence());
            assertNull(result.getTotalAmount());
            assertTrue(result.getItems().isEmpty());
        }

        @Test
        @DisplayName("Empty string returns LOW confidence")
        void emptyInput() {
            ReceiptParseResult result = parser.parseReceiptText("   ");
            assertEquals("LOW", result.getConfidence());
        }
    }

    // ====================================================================
    // Column header filtering
    // ====================================================================
    @Nested
    @DisplayName("Column Header Filtering")
    class ColumnHeaderFiltering {

        @Test
        @DisplayName("Does not treat ITEM QTY UNIT TOTAL as an item")
        void filtersColumnHeader() {
            String ocr = """
                    MY RESTAURANT
                    
                    ITEM QTY RATE AMOUNT
                    Biryani  2  250.00  500.00
                    Raita  1  50.00  50.00
                    
                    Total  550.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(2, result.getItems().size());
            for (BillItemRequest item : result.getItems()) {
                assertFalse(item.getName().toUpperCase().contains("QTY"),
                        "Column header should not be an item: " + item.getName());
            }
        }
    }

    // ====================================================================
    // Confidence scoring
    // ====================================================================
    @Nested
    @DisplayName("Confidence Scoring")
    class ConfidenceScoring {

        @Test
        @DisplayName("LOW confidence for gibberish OCR")
        void gibberish() {
            String ocr = """
                    xkcd $#@!
                    ~~~ ??? ===
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);
            assertEquals("LOW", result.getConfidence());
        }

        @Test
        @DisplayName("Not HIGH when total exists but no items")
        void totalButNoItems() {
            String ocr = """
                    STORE NAME
                    Some address line
                    Date something
                    Total 500.00
                    Thank you
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            // Should be MEDIUM at best, not HIGH (no items to validate against)
            assertNotEquals("HIGH", result.getConfidence(),
                    "Should not be HIGH with total but zero items; confidence=" + result.getConfidence());
        }

        @Test
        @DisplayName("HIGH confidence when items and total are consistent")
        void consistentItemsAndTotal() {
            String ocr = """
                    GOOD STORE
                    
                    Apple  100.00
                    Banana  50.00
                    Mango  150.00
                    
                    Total  300.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals("HIGH", result.getConfidence());
            assertEquals(300.00, result.getTotalAmount(), 0.01);
        }
    }

    // ====================================================================
    // Financial keyword line not treated as item
    // ====================================================================
    @Nested
    @DisplayName("Financial Lines Not Items")
    class FinancialLinesNotItems {

        @Test
        @DisplayName("TAX, SUBTOTAL, TOTAL, CGST, SGST not extracted as items")
        void financialLinesFiltered() {
            String ocr = """
                    DINER
                    
                    Burger  200.00
                    Fries  100.00
                    
                    Subtotal  300.00
                    CGST  15.00
                    SGST  15.00
                    Tax  30.00
                    Service Charge  30.00
                    Round Off  0.50
                    Grand Total  375.50
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            // Only Burger and Fries should be items
            assertEquals(2, result.getItems().size());
            assertEquals("Burger", result.getItems().get(0).getName());
            assertEquals("Fries", result.getItems().get(1).getName());
        }
    }

    // ====================================================================
    // Normalization
    // ====================================================================
    @Nested
    @DisplayName("Text Normalization")
    class TextNormalization {

        @Test
        @DisplayName("Normalizes whitespace and currency symbols")
        void normalization() {
            String raw = "  Coffee   ₹ 150.00  \n  Tea  Rs.  80.00  ";
            String normalized = parser.normalizeOcrText(raw);

            assertFalse(normalized.contains("₹"), "Currency symbol should be stripped");
            assertFalse(normalized.contains("Rs."), "Rs. prefix should be stripped");
            // Should not have double spaces
            assertFalse(normalized.contains("  "), "Double spaces should be collapsed");
        }
    }

    // ====================================================================
    // Raw OCR text preservation
    // ====================================================================
    @Nested
    @DisplayName("Raw Text Preservation")
    class RawTextPreservation {

        @Test
        @DisplayName("Preserves original raw OCR text in result")
        void rawTextPreserved() {
            String ocr = "STORE\nItem 100.00\nTotal 100.00";
            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(ocr, result.getRawText());
        }
    }

    // ====================================================================
    // Edge cases
    // ====================================================================
    @Nested
    @DisplayName("Edge Cases")
    class EdgeCases {

        @Test
        @DisplayName("Single item receipt")
        void singleItem() {
            String ocr = """
                    QUICK MART
                    
                    Water Bottle  20.00
                    
                    Total  20.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(1, result.getItems().size());
            assertEquals(20.00, result.getTotalAmount(), 0.01);
        }

        @Test
        @DisplayName("Multi-word item names with spaces")
        void multiWordItemNames() {
            String ocr = """
                    RESTAURANT
                    
                    Paneer Butter Masala  350.00
                    Dal Tadka Fry  180.00
                    Mixed Veg Curry  220.00
                    
                    Total  750.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(3, result.getItems().size());
            assertEquals("Paneer Butter Masala", result.getItems().get(0).getName());
        }

        @Test
        @DisplayName("Receipt with serial numbers before items")
        void serialNumberedItems() {
            String ocr = """
                    FOOD COURT
                    
                    1. Dosa  80.00
                    2. Idli  60.00
                    3. Vada  50.00
                    
                    Total  190.00
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(3, result.getItems().size());
            // Serial numbers should be stripped from names
            for (BillItemRequest item : result.getItems()) {
                assertFalse(item.getName().matches("^\\d+\\..*"),
                        "Serial number should be stripped: " + item.getName());
            }
        }
    }

    // ====================================================================
    // parseMoney utility
    // ====================================================================
    @Nested
    @DisplayName("parseMoney Utility")
    class ParseMoney {

        @Test
        @DisplayName("Parses standard decimal numbers")
        void standardNumbers() {
            assertEquals(100.00, parser.parseMoney("100.00"), 0.01);
            assertEquals(1234.56, parser.parseMoney("1234.56"), 0.01);
            assertEquals(45.0, parser.parseMoney("45"), 0.01);
        }

        @Test
        @DisplayName("Parses thousands-separated numbers")
        void thousandsSeparated() {
            assertEquals(1234.56, parser.parseMoney("1,234.56"), 0.01);
            assertEquals(25000.00, parser.parseMoney("25,000.00"), 0.01);
        }

        @Test
        @DisplayName("Parses comma as decimal separator")
        void commaDecimal() {
            assertEquals(150.50, parser.parseMoney("150,50"), 0.01);
        }

        @Test
        @DisplayName("Returns null for null/empty input")
        void nullEmpty() {
            assertNull(parser.parseMoney(null));
            assertNull(parser.parseMoney(""));
        }

        @Test
        @DisplayName("Handles negative values")
        void negativeValues() {
            assertEquals(-50.00, parser.parseMoney("-50.00"), 0.01);
        }
    }
}
