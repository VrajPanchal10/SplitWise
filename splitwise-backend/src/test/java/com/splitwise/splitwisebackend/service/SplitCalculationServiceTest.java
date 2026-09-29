package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.dto.BillBreakdownResponse;
import com.splitwise.splitwisebackend.dto.ParticipantShare;
import com.splitwise.splitwisebackend.dto.Settlement;
import com.splitwise.splitwisebackend.model.Bill;
import com.splitwise.splitwisebackend.model.BillItem;
import com.splitwise.splitwisebackend.model.SettlementRecord;
import com.splitwise.splitwisebackend.repository.BillRepository;
import com.splitwise.splitwisebackend.repository.SettlementRecordRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SplitCalculationServiceTest {

    @Mock
    private BillRepository billRepository;

    @Mock
    private SettlementRecordRepository settlementRecordRepository;

    private SplitCalculationService service;

    @BeforeEach
    void setUp() {
        service = new SplitCalculationService(billRepository, settlementRecordRepository);
    }

    private BillItem item(String name, double price, List<String> sharedBy) {
        BillItem item = new BillItem();
        item.setName(name);
        item.setPrice(price);
        item.setSharedByUserIds(sharedBy);
        return item;
    }

    private BillItem customItem(String name, double price, List<String> sharedBy, Map<String, Double> customShares) {
        BillItem item = new BillItem();
        item.setName(name);
        item.setPrice(price);
        item.setSharedByUserIds(sharedBy);
        item.setCustomShares(customShares);
        return item;
    }

    private Bill bill(String id, String groupId, String paidBy, double total, List<BillItem> items) {
        Bill bill = new Bill();
        bill.setId(id);
        bill.setGroupId(groupId);
        bill.setPaidBy(paidBy);
        bill.setTotalAmount(total);
        bill.setItems(items);
        return bill;
    }

    /**
     * Regression test for the reported bug:
     *
     * Group "It's" has 2 members: Kiran and Harsh.
     * - ₹200 group hotel bill paid by Harsh, split equally between both.
     * - ₹200 PERSONAL expense (no group) recorded for Harsh.
     *
     * Expected: Kiran owes Harsh exactly ₹100. Personal expense must contribute ₹0.
     *
     * Before the fix, sharedByUserIds = [Harsh, Kiran, Harsh] (payer duplicated by
     * the frontend) made the backend divide 200 by 3, producing 200/3 = 66.67.
     */
    @Test
    void groupBillWithDuplicatedPayer_splitsByUniqueParticipants() {
        // Simulate the exact frontend payload: payer is duplicated because group
        // members (which include the payer) were pre-selected AND the payer was
        // added explicitly: [Harsh, Kiran, Harsh]
        Bill groupBill = bill(
                "bill-1",
                "group-its",
                "harsh",
                200.0,
                List.of(item("Hotel", 200.0, List.of("harsh", "kiran", "harsh")))
        );

        when(billRepository.findByGroupId("group-its")).thenReturn(List.of(groupBill));
        when(settlementRecordRepository.findByGroupIdAndStatus(anyString(), any(SettlementRecord.Status.class)))
                .thenReturn(List.of());

        List<Settlement> settlements = service.getSettlementsForGroup("group-its");

        assertEquals(1, settlements.size());
        Settlement settlement = settlements.get(0);
        assertEquals("kiran", settlement.getFromUserId());
        assertEquals("harsh", settlement.getToUserId());
        assertEquals(100.0, settlement.getAmount(), 0.001,
                "Each person's share must be exactly 200 / 2 = 100, NOT 200 / 3 = 66.67");
    }

    /**
     * Personal expenses (groupId = null) must be COMPLETELY excluded from any
     * debt/settlement math.
     */
    @Test
    void personalExpenseWithoutGroup_isExcludedFromSettlements() {
        Bill groupBill = bill(
                "bill-1",
                "group-its",
                "harsh",
                200.0,
                List.of(item("Hotel", 200.0, List.of("harsh", "kiran")))
        );
        // Personal expense: no groupId
        Bill personalBill = bill(
                "bill-2",
                null,
                "harsh",
                200.0,
                List.of(item("Personal", 200.0, List.of("harsh")))
        );

        when(billRepository.findByGroupId("group-its")).thenReturn(List.of(groupBill, personalBill));
        when(settlementRecordRepository.findByGroupIdAndStatus(anyString(), any(SettlementRecord.Status.class)))
                .thenReturn(List.of());

        List<Settlement> settlements = service.getSettlementsForGroup("group-its");

        // Only the group bill contributes. Personal expense must have ZERO effect.
        assertEquals(1, settlements.size());
        Settlement settlement = settlements.get(0);
        assertEquals("kiran", settlement.getFromUserId());
        assertEquals("harsh", settlement.getToUserId());
        assertEquals(100.0, settlement.getAmount(), 0.001);
    }

    /**
     * Explicitly verify the personal bill contributes EXACTLY 0 to net balances
     * via the new unit-testable method.
     */
    @Test
    void calculateNetBalancesForGroup_personalBillContributesZero() {
        Bill groupBill = bill(
                "bill-1",
                "group-its",
                "harsh",
                200.0,
                List.of(item("Hotel", 200.0, List.of("harsh", "kiran")))
        );
        Bill personalBill = bill(
                "bill-2",
                null,
                "harsh",
                200.0,
                List.of(item("Personal", 200.0, List.of("harsh")))
        );

        when(billRepository.findByGroupId("group-its")).thenReturn(List.of(groupBill, personalBill));

        Map<String, Double> netBalances = service.calculateNetBalancesForGroup("group-its");

        // Harsh paid 200, owes 100 share → +100
        // Kiran owes 100 → -100
        assertEquals(100.0, netBalances.get("harsh"), 0.001);
        assertEquals(-100.0, netBalances.get("kiran"), 0.001);
        assertEquals(2, netBalances.size(),
                "Personal expense must not add entries or change balances");
    }

    /**
     * A group bill where all items reference only ONE unique person behaves like
     * a personal expense and must be excluded from settlements (defense-in-depth).
     */
    @Test
    void groupBillWithSingleUniqueParticipant_isTreatedAsPersonalExpense() {
        // Duplicated payer only: [Harsh, Harsh] → 1 unique participant
        Bill soloGroupBill = bill(
                "bill-1",
                "group-its",
                "harsh",
                200.0,
                List.of(item("Solo", 200.0, List.of("harsh", "harsh")))
        );

        when(billRepository.findByGroupId("group-its")).thenReturn(List.of(soloGroupBill));
        when(settlementRecordRepository.findByGroupIdAndStatus(anyString(), any(SettlementRecord.Status.class)))
                .thenReturn(List.of());

        List<Settlement> settlements = service.getSettlementsForGroup("group-its");

        assertTrue(settlements.isEmpty(),
                "A bill with a single unique participant must not create settlements");
    }

    // ====================================================================
    // TEST CASE: ₹2589 / 7 participants
    // ====================================================================
    @Test
    void equalSplit_2589_dividedBy_7_reconcilesExactly() {
        List<String> participants = List.of("vraj", "personB", "personC", "personD", "personE", "personF", "personG");
        Bill bill = bill("bill-2589", "group-1", "vraj", 2589.0,
                List.of(item("Dinner", 2589.0, participants)));

        Map<String, Double> shares = service.calculateIndividualShares(bill);

        assertEquals(7, shares.size());

        // Sum of all 7 shares must reconcile to EXACTLY 2589.00
        double totalShares = shares.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(2589.00, Math.round(totalShares * 100.0) / 100.0, 0.001,
                "Shares must reconcile exactly with bill total, never losing or creating money");

        // 258900 cents / 7 = 36985 cents with remainder 5 cents.
        // Payer Vraj (first) and 4 others get 369.86, remaining 2 get 369.85.
        assertEquals(369.86, shares.get("vraj"), 0.001);
        long countHigher = shares.values().stream().filter(s -> Math.abs(s - 369.86) < 0.005).count();
        long countLower = shares.values().stream().filter(s -> Math.abs(s - 369.85) < 0.005).count();
        assertEquals(5, countHigher, "5 participants must receive 369.86");
        assertEquals(2, countLower, "2 participants must receive 369.85");

        // Breakdown check:
        // Vraj paid ₹2589, share ₹369.86, net = +₹2219.14
        BillBreakdownResponse breakdown = service.calculateBillBreakdown(bill);
        assertNotNull(breakdown);
        assertEquals(2589.00, breakdown.getTotalAmount(), 0.001);
        assertEquals(7, breakdown.getParticipantCount());

        ParticipantShare vrajShare = breakdown.getParticipants().stream()
                .filter(p -> p.getUserId().equals("vraj"))
                .findFirst().orElseThrow();
        assertEquals(2589.00, vrajShare.getPaidAmount(), 0.001);
        assertEquals(369.86, vrajShare.getShareAmount(), 0.001);
        assertEquals(2219.14, vrajShare.getNetAmount(), 0.001);

        ParticipantShare personBShare = breakdown.getParticipants().stream()
                .filter(p -> p.getUserId().equals("personB"))
                .findFirst().orElseThrow();
        assertEquals(0.00, personBShare.getPaidAmount(), 0.001);
        assertEquals(369.86, personBShare.getShareAmount(), 0.001);
        assertEquals(-369.86, personBShare.getNetAmount(), 0.001);

        // Net amounts across all participants must sum to EXACTLY 0.00
        double totalNet = breakdown.getParticipants().stream()
                .mapToDouble(ParticipantShare::getNetAmount)
                .sum();
        assertEquals(0.00, Math.round(totalNet * 100.0) / 100.0, 0.001,
                "Net balances must sum to exactly zero");
    }

    // ====================================================================
    // TEST CASE: ₹100 / 3 participants
    // ====================================================================
    @Test
    void equalSplit_100_dividedBy_3_reconcilesExactly() {
        List<String> participants = List.of("alice", "bob", "charlie");
        Bill bill = bill("bill-100", "group-1", "alice", 100.0,
                List.of(item("Lunch", 100.0, participants)));

        Map<String, Double> shares = service.calculateIndividualShares(bill);

        assertEquals(3, shares.size());
        double totalShares = shares.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(100.00, Math.round(totalShares * 100.0) / 100.0, 0.001);

        // 10000 cents / 3 = 3333 cents, remainder 1 cent.
        // Alice (payer, 1st) gets 33.34, Bob and Charlie get 33.33.
        assertEquals(33.34, shares.get("alice"), 0.001);
        assertEquals(33.33, shares.get("bob"), 0.001);
        assertEquals(33.33, shares.get("charlie"), 0.001);
    }

    // ====================================================================
    // TEST CASE: ₹100.01 / 3 participants
    // ====================================================================
    @Test
    void equalSplit_100_01_dividedBy_3_reconcilesExactly() {
        List<String> participants = List.of("alice", "bob", "charlie");
        Bill bill = bill("bill-100-01", "group-1", "alice", 100.01,
                List.of(item("Snacks", 100.01, participants)));

        Map<String, Double> shares = service.calculateIndividualShares(bill);

        assertEquals(3, shares.size());
        double totalShares = shares.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(100.01, Math.round(totalShares * 100.0) / 100.0, 0.001);

        // 10001 cents / 3 = 3333 cents, remainder 2 cents.
        // Alice: 33.34, Bob: 33.34, Charlie: 33.33.
        assertEquals(33.34, shares.get("alice"), 0.001);
        assertEquals(33.34, shares.get("bob"), 0.001);
        assertEquals(33.33, shares.get("charlie"), 0.001);
    }

    // ====================================================================
    // TEST CASE: ₹999 / 6 participants
    // ====================================================================
    @Test
    void equalSplit_999_dividedBy_6_reconcilesExactly() {
        List<String> participants = List.of("u1", "u2", "u3", "u4", "u5", "u6");
        Bill bill = bill("bill-999", "group-1", "u1", 999.0,
                List.of(item("Movie Tickets", 999.0, participants)));

        Map<String, Double> shares = service.calculateIndividualShares(bill);

        assertEquals(6, shares.size());
        double totalShares = shares.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(999.00, Math.round(totalShares * 100.0) / 100.0, 0.001);

        // 99900 cents / 6 = 16650 cents exactly (no remainder)
        for (String u : participants) {
            assertEquals(166.50, shares.get(u), 0.001);
        }
    }

    // ====================================================================
    // TEST CASE: Unequal / Custom Shares
    // ====================================================================
    @Test
    void unequalShares_customAmounts_reconcilesExactly() {
        Map<String, Double> customShares = Map.of(
                "vraj", 500.00,
                "kiran", 300.00,
                "harsh", 200.00
        );

        Bill bill = bill("bill-custom", "group-1", "vraj", 1000.0,
                List.of(customItem("Custom Split Dinner", 1000.0,
                        List.of("vraj", "kiran", "harsh"), customShares)));

        Map<String, Double> shares = service.calculateIndividualShares(bill);

        assertEquals(3, shares.size());
        assertEquals(500.00, shares.get("vraj"), 0.001);
        assertEquals(300.00, shares.get("kiran"), 0.001);
        assertEquals(200.00, shares.get("harsh"), 0.001);

        double totalShares = shares.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(1000.00, Math.round(totalShares * 100.0) / 100.0, 0.001);

        // Breakdown check:
        // Vraj paid 1000.0, share 500.0 -> net +500.0
        // Kiran paid 0.0, share 300.0 -> net -300.0
        // Harsh paid 0.0, share 200.0 -> net -200.0
        BillBreakdownResponse breakdown = service.calculateBillBreakdown(bill);
        assertNotNull(breakdown);

        ParticipantShare vraj = breakdown.getParticipants().stream()
                .filter(p -> p.getUserId().equals("vraj")).findFirst().orElseThrow();
        assertEquals(1000.00, vraj.getPaidAmount(), 0.001);
        assertEquals(500.00, vraj.getShareAmount(), 0.001);
        assertEquals(500.00, vraj.getNetAmount(), 0.001);

        ParticipantShare kiran = breakdown.getParticipants().stream()
                .filter(p -> p.getUserId().equals("kiran")).findFirst().orElseThrow();
        assertEquals(0.00, kiran.getPaidAmount(), 0.001);
        assertEquals(300.00, kiran.getShareAmount(), 0.001);
        assertEquals(-300.00, kiran.getNetAmount(), 0.001);
    }

    // ====================================================================
    // TEST CASE: Custom amounts summing exactly with decimal cents
    // ====================================================================
    @Test
    void customAmounts_summingExactly() {
        Map<String, Double> customShares = Map.of(
                "p1", 250.25,
                "p2", 250.25
        );

        Bill bill = bill("bill-dec", "group-1", "p1", 500.50,
                List.of(customItem("Decimal Split", 500.50, List.of("p1", "p2"), customShares)));

        Map<String, Double> shares = service.calculateIndividualShares(bill);
        assertEquals(250.25, shares.get("p1"), 0.001);
        assertEquals(250.25, shares.get("p2"), 0.001);
        assertEquals(500.50, shares.get("p1") + shares.get("p2"), 0.001);
    }

    // ====================================================================
    // TEST CASE: Multiple participants where one payer paid the full amount
    // ====================================================================
    @Test
    void multipleParticipants_onePayerPaidFullAmount_netBalancesZeroSum() {
        List<String> participants = List.of("payer", "p2", "p3", "p4");
        Bill bill = bill("bill-full", "group-1", "payer", 1200.0,
                List.of(item("Hotel Room", 1200.0, participants)));

        BillBreakdownResponse breakdown = service.calculateBillBreakdown(bill);
        assertNotNull(breakdown);
        assertEquals(4, breakdown.getParticipantCount());

        ParticipantShare payer = breakdown.getParticipants().stream()
                .filter(p -> p.getUserId().equals("payer")).findFirst().orElseThrow();
        assertEquals(1200.00, payer.getPaidAmount(), 0.001);
        assertEquals(300.00, payer.getShareAmount(), 0.001);
        assertEquals(900.00, payer.getNetAmount(), 0.001);

        for (String pid : List.of("p2", "p3", "p4")) {
            ParticipantShare ps = breakdown.getParticipants().stream()
                    .filter(p -> p.getUserId().equals(pid)).findFirst().orElseThrow();
            assertEquals(0.00, ps.getPaidAmount(), 0.001);
            assertEquals(300.00, ps.getShareAmount(), 0.001);
            assertEquals(-300.00, ps.getNetAmount(), 0.001);
        }

        double netSum = breakdown.getParticipants().stream()
                .mapToDouble(ParticipantShare::getNetAmount)
                .sum();
        assertEquals(0.00, Math.round(netSum * 100.0) / 100.0, 0.001);
    }

    // ====================================================================
    // TEST CASE: Zero / empty participants handled safely
    // ====================================================================
    @Test
    void zeroOrEmptyParticipants_handledSafely() {
        Bill emptyBill = bill("bill-empty", "group-1", "user1", 100.0, List.of());
        Map<String, Double> shares = service.calculateIndividualShares(emptyBill);
        assertTrue(shares.isEmpty());

        Bill nullItemParticipants = bill("bill-null-part", "group-1", "user1", 100.0,
                List.of(item("Item", 100.0, null)));
        Map<String, Double> shares2 = service.calculateIndividualShares(nullItemParticipants);
        assertTrue(shares2.isEmpty());
    }
}