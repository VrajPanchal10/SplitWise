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

    // ====================================================================
    // Regression Suite - The Tack Room & Financial Pipeline Validation
    // ====================================================================
    @Nested
    @DisplayName("The Tack Room Regression Suite")
    class TheTackRoomRegressionSuite {

        private static final String TACK_ROOM_OCR = """
                The Tack Room
                145 Lincoln Road
                Lincoln, MA 01773

                Server: Griffin F

                Check #36                         Table 59
                Ordered:                    4/8/24 7:13 PM
                1 BBQ Potato Chips                   $7.00
                1 Diet Coke                          $3.00
                1 Trillium Fort Point               $10.00
                2 Fried Chicken Sandwich         $34.00
                1 Famous Duck Grilled Cheese        $25.00
                1 Mac & Cheese                      $17.00
                1 Burger of the moment          $18.00
                Subtotal                           $114.00
                Admin Fee (3.00%)                    $3.42
                Tax                                   $7.11
                Total                              $124.53

                Add us on Instagram: Tackroomlincoln
                """;

        @Test
        @DisplayName("1. The attached receipt parses into correct merchant, 7 items, subtotal, admin fee, tax, and total")
        void test1_AttachedReceiptCompletePipeline() {
            ReceiptParseResult result = parser.parseReceiptText(TACK_ROOM_OCR);

            assertEquals("The Tack Room", result.getSuggestedTitle());
            assertEquals("USD", result.getCurrency());
            assertEquals(114.00, result.getSubtotal(), 0.001);
            assertEquals(3.42, result.getServiceCharge(), 0.001);
            assertEquals(7.11, result.getTax(), 0.001);
            assertEquals(124.53, result.getTotalAmount(), 0.001);

            assertEquals(7, result.getItems().size());
            assertEquals("VALIDATED", result.getValidationStatus());
            assertEquals("HIGH", result.getConfidence());
        }

        @Test
        @DisplayName("2. Merchant-name extraction rejects OCR noise (T_T, ET) and extracts genuine title")
        void test2_MerchantNameExtraction() {
            String noisyHeaderOcr = """
                    T_T
                    The Tack Room
                    145 Lincoln Road
                    Lincoln, MA 01773
                    Server: Griffin F
                    Check #36 Table 59
                    1 BBQ Potato Chips $7.00
                    Subtotal $7.00
                    Total $7.00
                    """;
            ReceiptParseResult result = parser.parseReceiptText(noisyHeaderOcr);
            assertEquals("The Tack Room", result.getSuggestedTitle(), "Noise like T_T must not be chosen over genuine title");
        }

        @Test
        @DisplayName("3. Seven-item extraction and quantity handling (8 total units, Fried Chicken Sandwich qty=2, unitPrice=17.00)")
        void test3_SevenItemExtractionAndQuantityHandling() {
            ReceiptParseResult result = parser.parseReceiptText(TACK_ROOM_OCR);
            List<BillItemRequest> items = result.getItems();

            assertEquals(7, items.size(), "Must contain exactly 7 purchased line items");

            // Verify item 1
            assertEquals("BBQ Potato Chips", items.get(0).getName());
            assertEquals(1.0, items.get(0).getQuantity(), 0.001);
            assertEquals(7.00, items.get(0).getPrice(), 0.001);

            // Verify item 2
            assertEquals("Diet Coke", items.get(1).getName());
            assertEquals(1.0, items.get(1).getQuantity(), 0.001);
            assertEquals(3.00, items.get(1).getPrice(), 0.001);

            // Verify item 3
            assertEquals("Trillium Fort Point", items.get(2).getName());
            assertEquals(1.0, items.get(2).getQuantity(), 0.001);
            assertEquals(10.00, items.get(2).getPrice(), 0.001);

            // Verify item 4: Fried Chicken Sandwich (Qty 2, line total $34.00, unit $17.00)
            assertEquals("Fried Chicken Sandwich", items.get(3).getName());
            assertEquals(2.0, items.get(3).getQuantity(), 0.001);
            assertEquals(34.00, items.get(3).getPrice(), 0.001);
            assertEquals(17.00, items.get(3).getUnitPrice(), 0.001);

            // Verify item 5: Famous Duck Grilled Cheese
            assertEquals("Famous Duck Grilled Cheese", items.get(4).getName());
            assertEquals(1.0, items.get(4).getQuantity(), 0.001);
            assertEquals(25.00, items.get(4).getPrice(), 0.001);

            // Verify item 6: Mac & Cheese
            assertEquals("Mac & Cheese", items.get(5).getName());
            assertEquals(1.0, items.get(5).getQuantity(), 0.001);
            assertEquals(17.00, items.get(5).getPrice(), 0.001);

            // Verify item 7: Burger of the moment
            assertEquals("Burger of the moment", items.get(6).getName());
            assertEquals(1.0, items.get(6).getQuantity(), 0.001);
            assertEquals(18.00, items.get(6).getPrice(), 0.001);

            // Total units = 1 + 1 + 1 + 2 + 1 + 1 + 1 = 8
            double totalUnits = items.stream().mapToDouble(i -> i.getQuantity() != null ? i.getQuantity() : 1.0).sum();
            assertEquals(8.0, totalUnits, 0.001, "Total units must equal 8");

            // Sum of item prices = 114.00 (not doubled)
            double itemSum = items.stream().mapToDouble(BillItemRequest::getPrice).sum();
            assertEquals(114.00, itemSum, 0.001, "Sum of items must be $114.00");
        }

        @Test
        @DisplayName("4. Admin Fee (3%) is classified as service charge and NOT as a purchased item")
        void test4_AdminFeeClassification() {
            ReceiptParseResult result = parser.parseReceiptText(TACK_ROOM_OCR);

            assertEquals(3.42, result.getServiceCharge(), 0.001, "Admin Fee must be classified under serviceCharge");
            for (BillItemRequest item : result.getItems()) {
                assertFalse(item.getName().toLowerCase().contains("admin fee"), "Admin Fee must NOT be in purchased items list");
                assertFalse(item.getName().toLowerCase().contains("fee"), "Fees must NOT be in purchased items list");
            }
        }

        @Test
        @DisplayName("5. Subtotal ($114.00), tax ($7.11), and final-total ($124.53) extraction")
        void test5_SubtotalTaxAndFinalTotalExtraction() {
            ReceiptParseResult result = parser.parseReceiptText(TACK_ROOM_OCR);

            assertEquals(114.00, result.getSubtotal(), 0.001);
            assertEquals(7.11, result.getTax(), 0.001);
            assertEquals(124.53, result.getTotalAmount(), 0.001);
        }

        @Test
        @DisplayName("6. Correct financial validation (114.00 + 7.11 + 3.42 = 124.53) passes without suppressing errors")
        void test6_CorrectFinancialValidation() {
            ReceiptParseResult result = parser.parseReceiptText(TACK_ROOM_OCR);

            assertEquals("VALIDATED", result.getValidationStatus());
            assertNotNull(result.getValidationMessage());
            assertTrue(result.getValidationMessage().contains("mathematically validated"));
        }

        @Test
        @DisplayName("7. USD preservation across all fields")
        void test7_UsdPreservation() {
            ReceiptParseResult result = parser.parseReceiptText(TACK_ROOM_OCR);

            assertEquals("USD", result.getCurrency(), "Currency must be detected and preserved as USD");
            assertTrue(result.getValidationMessage().contains("$"), "Validation message should format in USD ($)");
        }

        @Test
        @DisplayName("8. Receipts without service charges validate correctly (Subtotal + Tax = Total)")
        void test8_ReceiptWithoutServiceCharges() {
            String ocr = """
                    STARBUCKS
                    1 Caffè Latte  $5.50
                    1 Croissant    $4.00
                    Subtotal       $9.50
                    Tax            $0.76
                    Total         $10.26
                    """;
            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals("USD", result.getCurrency());
            assertEquals(9.50, result.getSubtotal(), 0.001);
            assertNull(result.getServiceCharge());
            assertEquals(0.76, result.getTax(), 0.001);
            assertEquals(10.26, result.getTotalAmount(), 0.001);
            assertEquals(2, result.getItems().size());
            assertEquals("VALIDATED", result.getValidationStatus());
        }

        @Test
        @DisplayName("9. Receipts with multiple fees and discounts validate correctly")
        void test9_ReceiptWithMultipleFeesAndDiscounts() {
            String ocr = """
                    BISTRO GOURMET
                    1 Steak Frites  45.00
                    1 Wine Glass    15.00
                    Subtotal        60.00
                    Discount        -5.00
                    Admin Fee        2.00
                    Tax              4.40
                    Tip             10.00
                    Total           71.40
                    """;
            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(60.00, result.getSubtotal(), 0.001);
            assertEquals(5.00, Math.abs(result.getDiscount()), 0.001);
            assertEquals(2.00, result.getServiceCharge(), 0.001);
            assertEquals(4.40, result.getTax(), 0.001);
            assertEquals(10.00, result.getTip(), 0.001);
            assertEquals(71.40, result.getTotalAmount(), 0.001);
            assertEquals("VALIDATED", result.getValidationStatus(),
                    "Equation: 60 - 5 + 2 + 4.40 + 10 = 71.40 must be VALIDATED");
        }

        @Test
        @DisplayName("10. Genuine financial mismatches still produce FAILED_VALIDATION warning")
        void test10_GenuineFinancialMismatch() {
            String mismatchOcr = """
                    THE TACK ROOM
                    1 BBQ Potato Chips $7.00
                    Subtotal $114.00
                    Admin Fee (3.00%) $3.42
                    Tax $7.11
                    Total $150.00
                    """;
            ReceiptParseResult result = parser.parseReceiptText(mismatchOcr);

            assertEquals("FAILED_VALIDATION", result.getValidationStatus(),
                    "Total 150.00 != 114.00 + 3.42 + 7.11 (124.53) must produce FAILED_VALIDATION");
            assertEquals("LOW", result.getConfidence());
            assertTrue(result.getValidationMessage().contains("does not match"));
        }
    }

    // ====================================================================
    // Part 2 Acceptance Suite (Phase G Regression Tests)
    // ====================================================================
    @Nested
    @DisplayName("Part 2 Acceptance Suite")
    class Part2AcceptanceSuite {

        @Test
        @DisplayName("TEST 1 - USD Receipt: subtotal $108.50, tax $7.87, total $116.37 recognized in USD")
        void test1_UsdReceiptFixture() {
            String ocr = """
                    THE BLUE CRAB SEAFOOD
                    104 Ocean Drive, Miami, FL 33139
                    Date: 10/24/2026 19:45
                    Server: Alex Table: 12 Guests: 3
                    
                    ITEM QTY PRICE TOTAL
                    Grilled Salmon Fillet  1  42.00  42.00
                    Prime Ribeye Steak  1  48.50  48.50
                    Craft Draft Beer  2  9.00  18.00
                    
                    Subtotal: $108.50
                    Total Tax: $7.87
                    Total: $116.37
                    Order Balance due: $116.37
                    Thank you for dining with us!
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals("USD", result.getCurrency(), "Receipt denomination must be detected as USD, not INR");
            assertEquals(108.50, result.getSubtotal(), 0.01, "Printed subtotal must be 108.50");
            assertEquals(7.87, result.getTax(), 0.01, "Tax must be 7.87");
            assertEquals(116.37, result.getTotalAmount(), 0.01, "Total amount must be 116.37");
            assertEquals(3, result.getItems().size(), "Must extract exactly 3 purchased items");
            assertEquals("VALIDATED", result.getValidationStatus(), "Financial equation (108.50 + 7.87 = 116.37) must be VALIDATED");
            assertEquals("HIGH", result.getConfidence());

            // Check that items do not contain headers or metadata
            for (BillItemRequest item : result.getItems()) {
                assertFalse(item.getName().equalsIgnoreCase("ITEM"));
                assertFalse(item.getName().toLowerCase().contains("subtotal"));
                assertFalse(item.getName().toLowerCase().contains("tax"));
                assertFalse(item.getName().toLowerCase().contains("order balance"));
            }
        }

        @Test
        @DisplayName("TEST 2 - Receipt Items: Extracts genuine items, ignores column headers, metadata, footers")
        void test2_ReceiptItemsClassificationAndExtraction() {
            String ocr = """
                    BELLA ITALIA
                    Eat In - Table 7 - Server: Marco
                    Order #: 98124  Time: 20:15
                    
                    SR NO. ITEM DESCRIPTION QTY PRICE AMOUNT
                    1. Wood Fired Margherita Pizza  1  16.50  16.50
                    2. Creamy Fettuccine Alfredo with Truffle  1  24.00  24.00
                    3. Sparkling Mineral Water Large  2  4.50  9.00
                    
                    Promotional: Sign up for our rewards club!
                    Subtotal  49.50
                    Sales Tax  4.20
                    Total Due  53.70
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(3, result.getItems().size());
            assertEquals("Wood Fired Margherita Pizza", result.getItems().get(0).getName());
            assertEquals(16.50, result.getItems().get(0).getPrice(), 0.01);
            assertEquals("Creamy Fettuccine Alfredo with Truffle", result.getItems().get(1).getName());
            assertEquals(24.00, result.getItems().get(1).getPrice(), 0.01);
            assertEquals("Sparkling Mineral Water Large", result.getItems().get(2).getName());
            assertEquals(9.00, result.getItems().get(2).getPrice(), 0.01);
            assertEquals(53.70, result.getTotalAmount(), 0.01);
        }

        @Test
        @DisplayName("TEST 3 - Disagreement between item sum and printed subtotal produces warning without rewriting")
        void test3_ItemSubtotalDiscrepancy() {
            String ocr = """
                    RESTAURANT
                    Burger  15.00
                    Subtotal  108.50
                    Total Tax  7.87
                    Total  116.37
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            // Subtotal must remain what was printed (108.50), NOT rewritten to 15.00!
            assertEquals(108.50, result.getSubtotal(), 0.01);
            assertEquals(116.37, result.getTotalAmount(), 0.01);
            assertEquals(1, result.getItems().size());
            assertEquals(15.00, result.getItems().get(0).getPrice(), 0.01);

            // Validation status must be PARTIALLY_VALIDATED with clear discrepancy warning
            assertEquals("PARTIALLY_VALIDATED", result.getValidationStatus());
            assertTrue(result.getValidationMessage().contains("differs slightly") || result.getValidationMessage().contains("differs"));
        }

        @Test
        @DisplayName("TEST 4 - Financial validation matches valid equation and flags mismatch")
        void test4_FinancialValidationCases() {
            // Case A: Valid equation passes
            String validOcr = """
                    CAFE
                    Item 1  100.00
                    Subtotal  100.00
                    Tax  8.00
                    Total  108.00
                    """;
            ReceiptParseResult validResult = parser.parseReceiptText(validOcr);
            assertEquals("VALIDATED", validResult.getValidationStatus());

            // Case B: Mismatched equation fails validation
            String mismatchOcr = """
                    CAFE
                    Item 1  100.00
                    Subtotal  100.00
                    Tax  8.00
                    Total  150.00
                    """;
            ReceiptParseResult mismatchResult = parser.parseReceiptText(mismatchOcr);
            assertEquals("FAILED_VALIDATION", mismatchResult.getValidationStatus());
            assertEquals("LOW", mismatchResult.getConfidence(), "Confidence must be LOW when financial validation fails");
            assertTrue(mismatchResult.getValidationMessage().contains("does not match"));
        }

        @Test
        @DisplayName("TEST 5 - Corrupted OCR receipt total (SR ical:) is never classified as a purchased item")
        void test5_CorruptedOcrTotalSectionNotClassifiedAsPurchasedItem() {
            String ocr = """
                    TACO HAVEN
                    Taco Platter  15.00
                    SR ical: 108.50
                    Total Tax  7.87
                    Order Balance due: 116.37
                    """;

            ReceiptParseResult result = parser.parseReceiptText(ocr);

            assertEquals(1, result.getItems().size(), "Only Taco Platter should be an item, not 'SR ical:' or 'Order Balance due:'");
            assertEquals("Taco Platter", result.getItems().get(0).getName());
            assertEquals(108.50, result.getSubtotal(), 0.01);
            assertEquals(116.37, result.getTotalAmount(), 0.01);
        }
    }
}
