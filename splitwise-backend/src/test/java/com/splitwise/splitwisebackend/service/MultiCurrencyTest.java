package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.dto.BillBreakdownResponse;
import com.splitwise.splitwisebackend.dto.ParticipantShare;
import com.splitwise.splitwisebackend.dto.Settlement;
import com.splitwise.splitwisebackend.model.Bill;
import com.splitwise.splitwisebackend.model.BillItem;
import com.splitwise.splitwisebackend.model.Group;
import com.splitwise.splitwisebackend.repository.BillRepository;
import com.splitwise.splitwisebackend.repository.GroupRepository;
import com.splitwise.splitwisebackend.repository.SettlementRecordRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.LocalDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;

public class MultiCurrencyTest {

    private CurrencyConversionService currencyConversionService;
    private BillRepository billRepository;
    private SettlementRecordRepository settlementRecordRepository;
    private GroupRepository groupRepository;
    private SplitCalculationService splitCalculationService;

    @BeforeEach
    void setUp() {
        currencyConversionService = new CurrencyConversionService();
        billRepository = Mockito.mock(BillRepository.class);
        settlementRecordRepository = Mockito.mock(SettlementRecordRepository.class);
        groupRepository = Mockito.mock(GroupRepository.class);
        splitCalculationService = new SplitCalculationService(
                billRepository,
                settlementRecordRepository,
                null,
                groupRepository,
                currencyConversionService
        );
    }

    private BillItem item(String name, double price, List<String> sharedBy) {
        BillItem item = new BillItem();
        item.setName(name);
        item.setPrice(price);
        item.setSharedByUserIds(sharedBy);
        return item;
    }

    @Test
    @DisplayName("Test 1: INR-only expense preserves exact single-currency behavior")
    void testInrOnlyExpense() {
        Bill bill = new Bill();
        bill.setId("bill-inr-1");
        bill.setTitle("Dinner in Mumbai");
        bill.setPaidBy("user1");
        bill.setTotalAmount(1500.0);
        bill.setCurrency("INR");
        bill.setBaseCurrency("INR");
        bill.setExchangeRate(1.0);

        bill.setItems(List.of(item("Food", 1500.0, Arrays.asList("user1", "user2", "user3"))));

        BillBreakdownResponse breakdown = splitCalculationService.calculateBillBreakdown(bill);
        assertNotNull(breakdown);
        assertEquals("INR", breakdown.getCurrency());
        assertEquals("INR", breakdown.getBaseCurrency());
        assertEquals(1500.0, breakdown.getTotalAmount());
        assertEquals(1500.0, breakdown.getConvertedAmount());
        assertEquals(1.0, breakdown.getExchangeRate());

        // Each user share is 500 INR
        for (ParticipantShare share : breakdown.getParticipants()) {
            assertEquals(500.0, share.getShareAmount());
            assertEquals(500.0, share.getConvertedShareAmount());
            if ("user1".equals(share.getUserId())) {
                assertEquals(1500.0, share.getPaidAmount());
                assertEquals(1000.0, share.getNetAmount());
            } else {
                assertEquals(0.0, share.getPaidAmount());
                assertEquals(-500.0, share.getNetAmount());
            }
        }
    }

    @Test
    @DisplayName("Test 2: USD-only expense with USD group")
    void testUsdOnlyExpense() {
        Bill bill = new Bill();
        bill.setId("bill-usd-1");
        bill.setTitle("Lunch in NYC");
        bill.setPaidBy("user1");
        bill.setTotalAmount(90.0);
        bill.setCurrency("USD");
        bill.setBaseCurrency("USD");
        bill.setExchangeRate(1.0);

        bill.setItems(List.of(item("Pizza", 90.0, Arrays.asList("user1", "user2", "user3"))));

        BillBreakdownResponse breakdown = splitCalculationService.calculateBillBreakdown(bill);
        assertNotNull(breakdown);
        assertEquals("USD", breakdown.getCurrency());
        assertEquals("USD", breakdown.getBaseCurrency());
        assertEquals(90.0, breakdown.getTotalAmount());
        assertEquals(90.0, breakdown.getConvertedAmount());

        Map<String, Double> shares = splitCalculationService.calculateIndividualShares(bill);
        assertEquals(30.0, shares.get("user1"));
        assertEquals(30.0, shares.get("user2"));
        assertEquals(30.0, shares.get("user3"));
    }

    @Test
    @DisplayName("Test 3: USD expense displayed and converted in INR with historical exchange rate")
    void testUsdExpenseConvertedToInr() {
        Bill bill = new Bill();
        bill.setId("bill-usd-conv");
        bill.setTitle("Flight to Seattle");
        bill.setPaidBy("user1");
        bill.setTotalAmount(100.0);
        bill.setCurrency("USD");
        bill.setBaseCurrency("INR");
        bill.setExchangeRate(86.50);
        bill.setConvertedAmount(8650.0);
        bill.setExchangeRateDate(LocalDateTime.now());

        bill.setItems(List.of(item("Tickets", 100.0, Arrays.asList("user1", "user2"))));

        BillBreakdownResponse breakdown = splitCalculationService.calculateBillBreakdown(bill);
        assertEquals("USD", breakdown.getCurrency());
        assertEquals("INR", breakdown.getBaseCurrency());
        assertEquals(100.0, breakdown.getTotalAmount());
        assertEquals(8650.0, breakdown.getConvertedAmount());
        assertEquals(86.50, breakdown.getExchangeRate());

        ParticipantShare user2Share = breakdown.getParticipants().stream()
                .filter(p -> p.getUserId().equals("user2"))
                .findFirst().orElseThrow();
        assertEquals(50.0, user2Share.getShareAmount()); // $50 original
        assertEquals(4325.0, user2Share.getConvertedShareAmount()); // ₹4,325 converted
        assertEquals(-4325.0, user2Share.getConvertedNetAmount());
    }

    @Test
    @DisplayName("Test 4: Splitting foreign currency with indivisible remainder preserves exact pennies")
    void testSplittingForeignCurrencyIndivisibleRemainder() {
        Bill bill = new Bill();
        bill.setId("bill-usd-remainder");
        bill.setPaidBy("user1");
        bill.setTotalAmount(100.0);
        bill.setCurrency("USD");

        // $100 split 3 ways: 33.34, 33.33, 33.33
        bill.setItems(List.of(item("Hotel", 100.0, Arrays.asList("user1", "user2", "user3"))));

        Map<String, Double> shares = splitCalculationService.calculateIndividualShares(bill);
        assertEquals(33.34, shares.get("user1")); // payer gets remainder cent
        assertEquals(33.33, shares.get("user2"));
        assertEquals(33.33, shares.get("user3"));
        double sum = shares.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(100.0, Math.round(sum * 100.0) / 100.0);
    }

    @Test
    @DisplayName("Test 5: Balance aggregation across multi-currency expenses maintains zero-sum invariant")
    void testMultiCurrencyBalanceAggregation() {
        String groupId = "group-intl";
        Group group = new Group();
        group.setId(groupId);
        group.setDefaultCurrency("INR");
        when(groupRepository.findById(groupId)).thenReturn(Optional.of(group));

        // Bill 1: 100 USD (rate 86.50 -> 8,650 INR). user1 paid for user1, user2
        Bill bill1 = new Bill();
        bill1.setId("b1");
        bill1.setGroupId(groupId);
        bill1.setPaidBy("user1");
        bill1.setTotalAmount(100.0);
        bill1.setCurrency("USD");
        bill1.setBaseCurrency("INR");
        bill1.setExchangeRate(86.50);
        bill1.setItems(List.of(item("Item 1", 100.0, Arrays.asList("user1", "user2"))));

        // Bill 2: 1,000 INR (rate 1.0). user2 paid for user1, user2
        Bill bill2 = new Bill();
        bill2.setId("b2");
        bill2.setGroupId(groupId);
        bill2.setPaidBy("user2");
        bill2.setTotalAmount(1000.0);
        bill2.setCurrency("INR");
        bill2.setBaseCurrency("INR");
        bill2.setExchangeRate(1.0);
        bill2.setItems(List.of(item("Item 2", 1000.0, Arrays.asList("user1", "user2"))));

        when(billRepository.findByGroupId(groupId)).thenReturn(Arrays.asList(bill1, bill2));

        Map<String, Double> balances = splitCalculationService.calculateNetBalancesForGroup(groupId);

        // Bill 1: user1 pays 100 USD. user2 share is 50 USD = 4,325 INR. user1 share is 50 USD = 4,325 INR.
        // user1 credited +4,325 INR, user2 debited -4,325 INR.
        // Bill 2: user2 pays 1,000 INR. user1 share is 500 INR.
        // user2 credited +500 INR, user1 debited -500 INR.
        // Net: user1 = 4325 - 500 = +3,825 INR.
        // Net: user2 = -4325 + 500 = -3,825 INR.
        assertEquals(3825.0, balances.get("user1"));
        assertEquals(-3825.0, balances.get("user2"));

        // Sum of all balances must be exactly 0.00
        double netSum = balances.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(0.0, Math.round(netSum * 100.0) / 100.0);

        // Settlements should be generated in INR
        List<Settlement> settlements = splitCalculationService.getSettlementsForGroup(groupId);
        assertEquals(1, settlements.size());
        Settlement s = settlements.get(0);
        assertEquals("user2", s.getFromUserId());
        assertEquals("user1", s.getToUserId());
        assertEquals(3825.0, s.getAmount());
        assertEquals("INR", s.getCurrency());
    }

    @Test
    @DisplayName("Test 6: Backward compatibility for old expenses without currency defaults safely to INR")
    void testOldExpensesWithoutCurrencyCompatibility() {
        String groupId = "group-legacy";
        Group group = new Group();
        group.setId(groupId);
        group.setDefaultCurrency(null); // legacy group without currency
        when(groupRepository.findById(groupId)).thenReturn(Optional.of(group));

        Bill legacyBill = new Bill();
        legacyBill.setId("legacy-1");
        legacyBill.setGroupId(groupId);
        legacyBill.setPaidBy("user1");
        legacyBill.setTotalAmount(600.0);
        legacyBill.setCurrency(null); // null currency
        legacyBill.setBaseCurrency(null);
        legacyBill.setExchangeRate(null);
        legacyBill.setItems(List.of(item("Legacy Dinner", 600.0, Arrays.asList("user1", "user2"))));

        when(billRepository.findByGroupId(groupId)).thenReturn(List.of(legacyBill));

        BillBreakdownResponse breakdown = splitCalculationService.calculateBillBreakdown(legacyBill);
        assertEquals("INR", breakdown.getCurrency());
        assertEquals("INR", breakdown.getBaseCurrency());
        assertEquals(1.0, breakdown.getExchangeRate());
        assertEquals(600.0, breakdown.getConvertedAmount());

        Map<String, Double> balances = splitCalculationService.calculateNetBalancesForGroup(groupId);
        assertEquals(300.0, balances.get("user1"));
        assertEquals(-300.0, balances.get("user2"));
    }

    @Test
    @DisplayName("Test 7: Currency conversion rates and symbols validation")
    void testCurrencyConversionRatesAndSymbols() {
        assertEquals("₹", currencyConversionService.getCurrencySymbol("INR"));
        assertEquals("$", currencyConversionService.getCurrencySymbol("USD"));
        assertEquals("€", currencyConversionService.getCurrencySymbol("EUR"));
        assertEquals("£", currencyConversionService.getCurrencySymbol("GBP"));

        // Direct USD -> INR rate = 86.50
        assertEquals(86.50, currencyConversionService.getExchangeRate("USD", "INR"));
        // Inverse INR -> USD rate = 1 / 86.50 ≈ 0.0116
        double inrToUsd = currencyConversionService.getExchangeRate("INR", "USD");
        assertTrue(inrToUsd > 0.011 && inrToUsd < 0.012);

        // Cross rate: EUR -> INR = (USD -> INR) / (USD -> EUR) = 86.50 / 0.92 ≈ 94.0217
        double eurToInr = currencyConversionService.getExchangeRate("EUR", "INR");
        assertTrue(eurToInr > 93.0 && eurToInr < 95.0);

        // Convert 100 USD to INR
        assertEquals(8650.0, currencyConversionService.convert(100.0, "USD", "INR"));
    }

    @Test
    @DisplayName("Test 8: GBP expense converted to INR with deterministic precision")
    void testGbpExpenseConvertedToInr() {
        Bill bill = new Bill();
        bill.setId("bill-gbp-1");
        bill.setTitle("London Hotel");
        bill.setPaidBy("user1");
        bill.setTotalAmount(50.0);
        bill.setCurrency("GBP");
        bill.setBaseCurrency("INR");
        double rate = currencyConversionService.getExchangeRate("GBP", "INR");
        bill.setExchangeRate(rate); // 86.50 / 0.78 = 110.8974
        bill.setConvertedAmount(currencyConversionService.roundToTwoDecimals(50.0 * rate));

        bill.setItems(List.of(item("Hotel Room", 50.0, Arrays.asList("user1", "user2"))));

        BillBreakdownResponse breakdown = splitCalculationService.calculateBillBreakdown(bill);
        assertEquals("GBP", breakdown.getCurrency());
        assertEquals("INR", breakdown.getBaseCurrency());
        assertEquals(50.0, breakdown.getTotalAmount());
        assertEquals(5544.87, breakdown.getConvertedAmount());

        ParticipantShare user2Share = breakdown.getParticipants().stream()
                .filter(p -> p.getUserId().equals("user2"))
                .findFirst().orElseThrow();
        assertEquals(25.0, user2Share.getShareAmount());
        assertEquals(2772.43, user2Share.getConvertedShareAmount());
        assertEquals(-2772.43, user2Share.getConvertedNetAmount());
    }

    @Test
    @DisplayName("Test 9: EUR expense converted to INR")
    void testEurExpenseConvertedToInr() {
        Bill bill = new Bill();
        bill.setId("bill-eur-1");
        bill.setTitle("Paris Cafe");
        bill.setPaidBy("user1");
        bill.setTotalAmount(80.0);
        bill.setCurrency("EUR");
        bill.setBaseCurrency("INR");
        double rate = currencyConversionService.getExchangeRate("EUR", "INR");
        bill.setExchangeRate(rate); // 86.50 / 0.92 = 94.0217
        bill.setConvertedAmount(currencyConversionService.roundToTwoDecimals(80.0 * rate));

        bill.setItems(List.of(item("Pastries", 80.0, Arrays.asList("user1", "user2"))));

        BillBreakdownResponse breakdown = splitCalculationService.calculateBillBreakdown(bill);
        assertEquals("EUR", breakdown.getCurrency());
        assertEquals("INR", breakdown.getBaseCurrency());
        assertEquals(80.0, breakdown.getTotalAmount());
        assertEquals(7521.74, breakdown.getConvertedAmount());

        Map<String, Double> inrShares = splitCalculationService.calculateIndividualInrShares(bill);
        assertEquals(3760.87, inrShares.get("user1"));
        assertEquals(3760.87, inrShares.get("user2"));
        assertEquals(7521.74, inrShares.get("user1") + inrShares.get("user2"));
    }

    @Test
    @DisplayName("Test 10: The Tack Room fixture ($124.53 USD @ 90.0) split 4 ways into exact INR shares")
    void testTheTackRoomFixtureSplitFourWays() {
        Bill bill = new Bill();
        bill.setId("bill-tack-room");
        bill.setTitle("The Tack Room");
        bill.setPaidBy("user1");
        bill.setTotalAmount(124.53);
        bill.setCurrency("USD");
        bill.setBaseCurrency("INR");
        bill.setExchangeRate(90.0);
        bill.setConvertedAmount(11207.70); // 124.53 * 90.0 = 11,207.70 INR

        bill.setItems(List.of(
                item("BBQ Potato Chips", 7.00, Arrays.asList("user1", "user2", "user3", "user4")),
                item("Diet Coke", 3.00, Arrays.asList("user1", "user2", "user3", "user4")),
                item("Trillium Fort Point", 10.00, Arrays.asList("user1", "user2", "user3", "user4")),
                item("Fried Chicken Sandwich", 34.00, Arrays.asList("user1", "user2", "user3", "user4")),
                item("Famous Duck Grilled Cheese", 25.00, Arrays.asList("user1", "user2", "user3", "user4")),
                item("Mac & Cheese", 17.00, Arrays.asList("user1", "user2", "user3", "user4")),
                item("Burger of the moment", 18.00, Arrays.asList("user1", "user2", "user3", "user4")),
                item("Admin Fee & Tax", 10.53, Arrays.asList("user1", "user2", "user3", "user4"))
        ));

        BillBreakdownResponse breakdown = splitCalculationService.calculateBillBreakdown(bill);
        assertNotNull(breakdown);
        assertEquals("USD", breakdown.getCurrency());
        assertEquals("INR", breakdown.getBaseCurrency());
        assertEquals(124.53, breakdown.getTotalAmount());
        assertEquals(11207.70, breakdown.getConvertedAmount());

        Map<String, Double> inrShares = splitCalculationService.calculateIndividualInrShares(bill);
        assertEquals(4, inrShares.size());

        // Sum of all 4 shares in INR must equal exactly 11,207.70
        double sum = inrShares.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(11207.70, Math.round(sum * 100.0) / 100.0);

        // Individual shares are ~2,801.93 / 2,801.92
        for (double share : inrShares.values()) {
            assertTrue(share >= 2801.90 && share <= 2801.95, "Share should be approx 2801.93, got: " + share);
        }
    }

    @Test
    @DisplayName("Test 11: Partial and full INR settlements correctly update net balances")
    void testPartialAndFullInrSettlements() {
        String groupId = "group-settle";
        Group group = new Group();
        group.setId(groupId);
        group.setDefaultCurrency("INR");
        when(groupRepository.findById(groupId)).thenReturn(Optional.of(group));

        // 100 USD bill (rate 90 -> 9,000 INR). user1 paid for user1, user2
        Bill bill = new Bill();
        bill.setId("bill-settle");
        bill.setGroupId(groupId);
        bill.setPaidBy("user1");
        bill.setTotalAmount(100.0);
        bill.setCurrency("USD");
        bill.setBaseCurrency("INR");
        bill.setExchangeRate(90.0);
        bill.setConvertedAmount(9000.0);
        bill.setItems(List.of(item("Hotel", 100.0, Arrays.asList("user1", "user2"))));

        when(billRepository.findByGroupId(groupId)).thenReturn(List.of(bill));

        // Initial balance: user2 owes user1 4,500 INR
        Map<String, Double> initialBalances = splitCalculationService.calculateNetBalancesForGroup(groupId);
        assertEquals(4500.0, initialBalances.get("user1"));
        assertEquals(-4500.0, initialBalances.get("user2"));

        // Partial settlement: user2 pays 2,000 INR to user1
        com.splitwise.splitwisebackend.model.SettlementRecord partialSettlement =
                new com.splitwise.splitwisebackend.model.SettlementRecord();
        partialSettlement.setGroupId(groupId);
        partialSettlement.setFromUserId("user2");
        partialSettlement.setToUserId("user1");
        partialSettlement.setAmount(2000.0);
        partialSettlement.setCurrency("INR");
        partialSettlement.setStatus(com.splitwise.splitwisebackend.model.SettlementRecord.Status.PAID);

        when(settlementRecordRepository.findByGroupIdAndStatus(groupId,
                com.splitwise.splitwisebackend.model.SettlementRecord.Status.PAID))
                .thenReturn(List.of(partialSettlement));

        Map<String, Double> remainingAfterPartial = splitCalculationService.calculateRemainingNetBalancesForGroup(groupId);
        assertEquals(2500.0, remainingAfterPartial.get("user1"));
        assertEquals(-2500.0, remainingAfterPartial.get("user2"));

        // Full settlement: user2 pays remaining 2,500 INR to user1
        com.splitwise.splitwisebackend.model.SettlementRecord finalSettlement =
                new com.splitwise.splitwisebackend.model.SettlementRecord();
        finalSettlement.setGroupId(groupId);
        finalSettlement.setFromUserId("user2");
        finalSettlement.setToUserId("user1");
        finalSettlement.setAmount(2500.0);
        finalSettlement.setCurrency("INR");
        finalSettlement.setStatus(com.splitwise.splitwisebackend.model.SettlementRecord.Status.PAID);

        when(settlementRecordRepository.findByGroupIdAndStatus(groupId,
                com.splitwise.splitwisebackend.model.SettlementRecord.Status.PAID))
                .thenReturn(Arrays.asList(partialSettlement, finalSettlement));

        Map<String, Double> remainingAfterFull = splitCalculationService.calculateRemainingNetBalancesForGroup(groupId);
        assertEquals(0.0, remainingAfterFull.get("user1"));
        assertEquals(0.0, remainingAfterFull.get("user2"));
    }

    @Test
    @DisplayName("Test 12: Historical expense display uses locked rate even if reference rate changes")
    void testHistoricalExpenseUsesLockedRate() {
        Bill historicalBill = new Bill();
        historicalBill.setId("hist-1");
        historicalBill.setTitle("Tokyo Dinner");
        historicalBill.setPaidBy("user1");
        historicalBill.setTotalAmount(100.0);
        historicalBill.setCurrency("USD");
        historicalBill.setBaseCurrency("INR");
        historicalBill.setExchangeRate(82.50); // Locked historical rate from 1 year ago
        historicalBill.setConvertedAmount(8250.0);
        historicalBill.setItems(List.of(item("Sushi", 100.0, Arrays.asList("user1", "user2"))));

        // Even though current USD/INR rate is 86.50, the breakdown must preserve historical 82.50
        BillBreakdownResponse breakdown = splitCalculationService.calculateBillBreakdown(historicalBill);
        assertEquals(82.50, breakdown.getExchangeRate());
        assertEquals(8250.0, breakdown.getConvertedAmount());

        Map<String, Double> inrShares = splitCalculationService.calculateIndividualInrShares(historicalBill);
        assertEquals(4125.0, inrShares.get("user1"));
        assertEquals(4125.0, inrShares.get("user2"));
    }

    @Test
    @DisplayName("Test 13: Multiple expenses across USD, EUR, and INR between same participants")
    void testMultipleExpensesAcrossDifferentCurrencies() {
        String groupId = "group-multi";
        Group group = new Group();
        group.setId(groupId);
        group.setDefaultCurrency("INR");
        when(groupRepository.findById(groupId)).thenReturn(Optional.of(group));

        // Bill 1: 50 USD (rate 90 -> 4,500 INR). user1 paid for user1, user2
        Bill b1 = new Bill();
        b1.setId("b1");
        b1.setGroupId(groupId);
        b1.setPaidBy("user1");
        b1.setTotalAmount(50.0);
        b1.setCurrency("USD");
        b1.setBaseCurrency("INR");
        b1.setExchangeRate(90.0);
        b1.setConvertedAmount(4500.0);
        b1.setItems(List.of(item("Item USD", 50.0, Arrays.asList("user1", "user2"))));

        // Bill 2: 40 EUR (rate 100 -> 4,000 INR). user2 paid for user1, user2
        Bill b2 = new Bill();
        b2.setId("b2");
        b2.setGroupId(groupId);
        b2.setPaidBy("user2");
        b2.setTotalAmount(40.0);
        b2.setCurrency("EUR");
        b2.setBaseCurrency("INR");
        b2.setExchangeRate(100.0);
        b2.setConvertedAmount(4000.0);
        b2.setItems(List.of(item("Item EUR", 40.0, Arrays.asList("user1", "user2"))));

        // Bill 3: 500 INR (rate 1.0). user1 paid for user1, user2
        Bill b3 = new Bill();
        b3.setId("b3");
        b3.setGroupId(groupId);
        b3.setPaidBy("user1");
        b3.setTotalAmount(500.0);
        b3.setCurrency("INR");
        b3.setBaseCurrency("INR");
        b3.setExchangeRate(1.0);
        b3.setConvertedAmount(500.0);
        b3.setItems(List.of(item("Item INR", 500.0, Arrays.asList("user1", "user2"))));

        when(billRepository.findByGroupId(groupId)).thenReturn(Arrays.asList(b1, b2, b3));

        Map<String, Double> balances = splitCalculationService.calculateNetBalancesForGroup(groupId);

        // Bill 1: user1 +2250, user2 -2250
        // Bill 2: user2 +2000, user1 -2000
        // Bill 3: user1 +250, user2 -250
        // Net: user1 = 2250 - 2000 + 250 = +500 INR
        // Net: user2 = -2250 + 2000 - 250 = -500 INR
        assertEquals(500.0, balances.get("user1"));
        assertEquals(-500.0, balances.get("user2"));
        assertEquals(0.0, balances.get("user1") + balances.get("user2"));
    }
}
