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

import java.util.Arrays;
import java.util.Collections;
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

    // ====================================================================
    // SETTLEMENT & DEBT SIMPLIFICATION TESTS
    // ====================================================================

    @Test
    void simplifyDebts_twoPeople_singleTransaction() {
        Map<String, Double> balances = Map.of(
                "alice", 50.0,
                "bob", -50.0
        );

        List<Settlement> settlements = service.simplifyDebts(balances);
        assertEquals(1, settlements.size());
        assertEquals("bob", settlements.get(0).getFromUserId());
        assertEquals("alice", settlements.get(0).getToUserId());
        assertEquals(50.0, settlements.get(0).getAmount(), 0.001);
    }

    @Test
    void simplifyDebts_threePeople_circularDebtZeroBalances_emptySettlements() {
        // When debts cancel out into zero balances, no settlements should be produced
        Map<String, Double> balances = Map.of(
                "alice", 0.0,
                "bob", 0.0,
                "charlie", 0.0
        );

        List<Settlement> settlements = service.simplifyDebts(balances);
        assertTrue(settlements.isEmpty(), "Zero balances must produce no settlements");
    }

    @Test
    void simplifyDebts_threePeople_multipleDebtorsSingleCreditor() {
        // Alice is owed 150; Bob owes 100, Charlie owes 50
        Map<String, Double> balances = Map.of(
                "alice", 150.0,
                "bob", -100.0,
                "charlie", -50.0
        );

        List<Settlement> settlements = service.simplifyDebts(balances);
        assertEquals(2, settlements.size());

        // Bob -> Alice 100.0, Charlie -> Alice 50.0
        Settlement s1 = settlements.get(0);
        assertEquals("bob", s1.getFromUserId());
        assertEquals("alice", s1.getToUserId());
        assertEquals(100.0, s1.getAmount(), 0.001);

        Settlement s2 = settlements.get(1);
        assertEquals("charlie", s2.getFromUserId());
        assertEquals("alice", s2.getToUserId());
        assertEquals(50.0, s2.getAmount(), 0.001);

        // Money conservation check
        double totalPaid = settlements.stream().mapToDouble(Settlement::getAmount).sum();
        assertEquals(150.0, totalPaid, 0.001);
    }

    @Test
    void simplifyDebts_threePeople_multipleCreditorsSingleDebtor() {
        // Charlie owes 150; Alice is owed 80, Bob is owed 70
        Map<String, Double> balances = Map.of(
                "alice", 80.0,
                "bob", 70.0,
                "charlie", -150.0
        );

        List<Settlement> settlements = service.simplifyDebts(balances);
        assertEquals(2, settlements.size());

        for (Settlement s : settlements) {
            assertEquals("charlie", s.getFromUserId(), "Charlie must pay both creditors");
        }

        double totalPaid = settlements.stream().mapToDouble(Settlement::getAmount).sum();
        assertEquals(150.0, totalPaid, 0.001, "Total money paid must equal 150.0");
    }

    @Test
    void simplifyDebts_fivePlusPeople_exactMatchAndGreedySimplification() {
        // 5 people:
        // Creditors: Alice (+100.00), Bob (+50.00) => +150.00
        // Debtors: Charlie (-60.00), Dave (-50.00), Eve (-40.00) => -150.00
        //
        // Exact match optimization:
        // Dave (-50.00) exactly matches Bob (+50.00) -> 1 transaction (Dave -> Bob: 50.00)
        // Remaining: Charlie (-60.00) & Eve (-40.00) -> Alice (+100.00)
        // Total transactions = 3 (optimal!)
        Map<String, Double> balances = Map.of(
                "alice", 100.0,
                "bob", 50.0,
                "charlie", -60.0,
                "dave", -50.0,
                "eve", -40.0
        );

        List<Settlement> settlements = service.simplifyDebts(balances);
        assertEquals(3, settlements.size(), "5-person graph simplifies to exactly 3 transactions");

        // Verify Dave paid Bob 50.00 directly
        Settlement daveBob = settlements.stream()
                .filter(s -> s.getFromUserId().equals("dave") && s.getToUserId().equals("bob"))
                .findFirst().orElse(null);
        assertNotNull(daveBob, "Dave should pay Bob 50.00 via exact match");
        assertEquals(50.0, daveBob.getAmount(), 0.001);

        // Verify total money conserved
        double totalPaid = settlements.stream().mapToDouble(Settlement::getAmount).sum();
        assertEquals(150.0, totalPaid, 0.001, "Total money must be conserved");
    }

    @Test
    void simplifyDebts_decimalAmountsAndRounding() {
        // Decimal cents: 100 / 3
        Map<String, Double> balances = Map.of(
                "alice", 66.66,
                "bob", -33.33,
                "charlie", -33.33
        );

        List<Settlement> settlements = service.simplifyDebts(balances);
        assertEquals(2, settlements.size());

        double totalPaid = settlements.stream().mapToDouble(Settlement::getAmount).sum();
        assertEquals(66.66, Math.round(totalPaid * 100.0) / 100.0, 0.001,
                "Decimal cents must be conserved without losing pennies");

        for (Settlement s : settlements) {
            assertEquals("alice", s.getToUserId());
            assertEquals(33.33, s.getAmount(), 0.001);
        }
    }

    @Test
    void getSettlementsForGroup_alreadySettledGroup_returnsEmptyList() {
        // Group with 1 bill where Harsh paid 200 split between Harsh and Kiran
        Bill bill = bill("b-settled", "group-settled", "harsh", 200.0,
                List.of(item("Hotel", 200.0, List.of("harsh", "kiran"))));

        when(billRepository.findByGroupId("group-settled")).thenReturn(List.of(bill));

        // Kiran already paid Harsh 100.00
        SettlementRecord paidRecord = new SettlementRecord();
        paidRecord.setGroupId("group-settled");
        paidRecord.setFromUserId("kiran");
        paidRecord.setToUserId("harsh");
        paidRecord.setAmount(100.0);
        paidRecord.setStatus(SettlementRecord.Status.PAID);

        when(settlementRecordRepository.findByGroupIdAndStatus("group-settled", SettlementRecord.Status.PAID))
                .thenReturn(List.of(paidRecord));

        List<Settlement> settlements = service.getSettlementsForGroup("group-settled");
        assertTrue(settlements.isEmpty(), "An already settled group must return no pending settlements");
    }

    @Test
    void calculateNetBalancesForGroup_conservesMoney_sumIsZero() {
        // Multi-bill scenario with multiple payers
        Bill bill1 = bill("b1", "group-multi", "p1", 300.0,
                List.of(item("Dinner", 300.0, List.of("p1", "p2", "p3"))));
        Bill bill2 = bill("b2", "group-multi", "p2", 150.0,
                List.of(item("Taxi", 150.0, List.of("p1", "p2", "p3"))));

        when(billRepository.findByGroupId("group-multi")).thenReturn(List.of(bill1, bill2));

        Map<String, Double> netBalances = service.calculateNetBalancesForGroup("group-multi");

        // Invariant: sum of all net balances must equal 0.00
        double sum = netBalances.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(0.00, Math.round(sum * 100.0) / 100.0, 0.001,
                "Sum of all net balances must be identically zero");

        // p1 paid 300, owes 100 + 50 = 150 => net +150
        assertEquals(150.0, netBalances.get("p1"), 0.001);
        // p2 paid 150, owes 100 + 50 = 150 => net 0
        assertEquals(0.0, netBalances.get("p2"), 0.001);
        // p3 paid 0, owes 100 + 50 = 150 => net -150
        assertEquals(-150.0, netBalances.get("p3"), 0.001);
    }

    // =========================================================================
    // MANDATORY TASK CASES: SETTLEMENT SYNCHRONIZATION TESTS
    // =========================================================================

    /**
     * CASE A: One person pays entire expense.
     * Group: Jammu Kashmir Trip
     * Vraj paid ₹3,529. Equal split among 4 people = ₹882.25 each.
     * Expected: Mehr -> Vraj ₹882.25, Nidhi -> Vraj ₹882.25, User4 -> Vraj ₹882.25.
     * Vraj must never owe himself.
     */
    @Test
    void testCaseA_onePersonPaysEntireExpense_allDebtorsOweEqualShares() {
        String groupId = "jk-trip";
        Bill traveling = bill("b-travel", groupId, "vraj", 3529.0,
                List.of(item("Traveling", 3529.0, List.of("vraj", "mehr", "nidhi", "user4"))));

        when(billRepository.findByGroupId(groupId)).thenReturn(List.of(traveling));
        when(settlementRecordRepository.findByGroupIdAndStatus(groupId, SettlementRecord.Status.PAID))
                .thenReturn(List.of());

        List<Settlement> settlements = service.getSettlementsForGroup(groupId);

        assertEquals(3, settlements.size(), "Exactly 3 debtors must owe Vraj");
        for (Settlement s : settlements) {
            assertEquals("vraj", s.getToUserId(), "All payments must go to Vraj");
            assertNotEquals("vraj", s.getFromUserId(), "Vraj must never owe himself");
            assertEquals(882.25, s.getAmount(), 0.001, "Each debtor owes exactly ₹882.25");
        }

        // Verify remaining net balances
        Map<String, Double> remaining = service.calculateRemainingNetBalancesForGroup(groupId);
        assertEquals(2646.75, remaining.get("vraj"), 0.001);
        assertEquals(-882.25, remaining.get("mehr"), 0.001);
        assertEquals(-882.25, remaining.get("nidhi"), 0.001);
        assertEquals(-882.25, remaining.get("user4"), 0.001);

        // Verify original bill remains completely unchanged
        assertEquals(3529.0, traveling.getTotalAmount(), 0.001);
        assertEquals("vraj", traveling.getPaidBy());
    }

    /**
     * CASE B: One debtor settles the complete amount.
     * Mehr pays Vraj ₹882.25.
     * Expected: Mehr owes ₹0, Nidhi -> Vraj ₹882.25, User4 -> Vraj ₹882.25.
     * Vraj total receivable decreases by ₹882.25 to ₹1764.50.
     */
    @Test
    void testCaseB_oneDebtorSettlesCompleteAmount_debtBecomesZero_othersUnchanged() {
        String groupId = "jk-trip";
        Bill traveling = bill("b-travel", groupId, "vraj", 3529.0,
                List.of(item("Traveling", 3529.0, List.of("vraj", "mehr", "nidhi", "user4"))));

        SettlementRecord mehrPaid = new SettlementRecord();
        mehrPaid.setGroupId(groupId);
        mehrPaid.setFromUserId("mehr");
        mehrPaid.setToUserId("vraj");
        mehrPaid.setAmount(882.25);
        mehrPaid.setStatus(SettlementRecord.Status.PAID);

        when(billRepository.findByGroupId(groupId)).thenReturn(List.of(traveling));
        when(settlementRecordRepository.findByGroupIdAndStatus(groupId, SettlementRecord.Status.PAID))
                .thenReturn(List.of(mehrPaid));

        List<Settlement> settlements = service.getSettlementsForGroup(groupId);

        assertEquals(2, settlements.size(), "Only Nidhi and User4 should remain owing");
        assertTrue(settlements.stream().noneMatch(s -> s.getFromUserId().equals("mehr")),
                "Mehr must have zero remaining debt");
        assertTrue(settlements.stream().anyMatch(s -> s.getFromUserId().equals("nidhi") && s.getAmount() == 882.25));
        assertTrue(settlements.stream().anyMatch(s -> s.getFromUserId().equals("user4") && s.getAmount() == 882.25));

        Map<String, Double> remaining = service.calculateRemainingNetBalancesForGroup(groupId);
        assertEquals(0.0, remaining.get("mehr"), 0.001, "Mehr's remaining balance must be exactly 0.0");
        assertEquals(1764.50, remaining.get("vraj"), 0.001, "Vraj receivable must be reduced to ₹1764.50");

        // Original bill is untouched
        assertEquals(3529.0, traveling.getTotalAmount(), 0.001);
    }

    /**
     * CASE C: One debtor partially settles.
     * Mehr owes ₹882.25 and pays ₹500.00.
     * Expected:
     * - Mehr owes Vraj ₹382.25
     * - Nidhi owes Vraj ₹882.25
     * - User4 owes Vraj ₹882.25
     * - Vraj receivable becomes ₹2146.75.
     */
    @Test
    void testCaseC_oneDebtorPartiallySettles_partialDebtRemaining() {
        String groupId = "jk-trip";
        Bill traveling = bill("b-travel", groupId, "vraj", 3529.0,
                List.of(item("Traveling", 3529.0, List.of("vraj", "mehr", "nidhi", "user4"))));

        SettlementRecord partialSettlement = new SettlementRecord();
        partialSettlement.setGroupId(groupId);
        partialSettlement.setFromUserId("mehr");
        partialSettlement.setToUserId("vraj");
        partialSettlement.setAmount(500.0);
        partialSettlement.setStatus(SettlementRecord.Status.PAID);

        when(billRepository.findByGroupId(groupId)).thenReturn(List.of(traveling));
        when(settlementRecordRepository.findByGroupIdAndStatus(groupId, SettlementRecord.Status.PAID))
                .thenReturn(List.of(partialSettlement));

        List<Settlement> settlements = service.getSettlementsForGroup(groupId);

        assertEquals(3, settlements.size());
        Settlement mehrDebt = settlements.stream()
                .filter(s -> s.getFromUserId().equals("mehr"))
                .findFirst().orElseThrow();
        assertEquals("vraj", mehrDebt.getToUserId());
        assertEquals(382.25, mehrDebt.getAmount(), 0.001, "Mehr remaining debt must be ₹382.25");

        Map<String, Double> remaining = service.calculateRemainingNetBalancesForGroup(groupId);
        assertEquals(-382.25, remaining.get("mehr"), 0.001);
        assertEquals(2146.75, remaining.get("vraj"), 0.001);

        // Original bill is untouched
        assertEquals(3529.0, traveling.getTotalAmount(), 0.001);
    }

    /**
     * CASE D: Multiple debtors settle independently.
     * Mehr settles ₹882.25 and Nidhi settles ₹882.25 independently.
     * Expected:
     * - User4 owes Vraj ₹882.25
     * - Mehr owes ₹0
     * - Nidhi owes ₹0
     * - Vraj receivable becomes ₹882.25.
     */
    @Test
    void testCaseD_multipleDebtorsSettleIndependently() {
        String groupId = "jk-trip";
        Bill traveling = bill("b-travel", groupId, "vraj", 3529.0,
                List.of(item("Traveling", 3529.0, List.of("vraj", "mehr", "nidhi", "user4"))));

        SettlementRecord mehrPaid = new SettlementRecord();
        mehrPaid.setGroupId(groupId);
        mehrPaid.setFromUserId("mehr");
        mehrPaid.setToUserId("vraj");
        mehrPaid.setAmount(882.25);
        mehrPaid.setStatus(SettlementRecord.Status.PAID);

        SettlementRecord nidhiPaid = new SettlementRecord();
        nidhiPaid.setGroupId(groupId);
        nidhiPaid.setFromUserId("nidhi");
        nidhiPaid.setToUserId("vraj");
        nidhiPaid.setAmount(882.25);
        nidhiPaid.setStatus(SettlementRecord.Status.PAID);

        when(billRepository.findByGroupId(groupId)).thenReturn(List.of(traveling));
        when(settlementRecordRepository.findByGroupIdAndStatus(groupId, SettlementRecord.Status.PAID))
                .thenReturn(List.of(mehrPaid, nidhiPaid));

        List<Settlement> settlements = service.getSettlementsForGroup(groupId);

        assertEquals(1, settlements.size(), "Only User4 should owe Vraj");
        Settlement user4Debt = settlements.get(0);
        assertEquals("user4", user4Debt.getFromUserId());
        assertEquals("vraj", user4Debt.getToUserId());
        assertEquals(882.25, user4Debt.getAmount(), 0.001);

        Map<String, Double> remaining = service.calculateRemainingNetBalancesForGroup(groupId);
        assertEquals(0.0, remaining.get("mehr"), 0.001);
        assertEquals(0.0, remaining.get("nidhi"), 0.001);
        assertEquals(-882.25, remaining.get("user4"), 0.001);
        assertEquals(882.25, remaining.get("vraj"), 0.001);

        // Invariant: sum of all remaining balances is 0.0
        double sum = remaining.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(0.0, Math.round(sum * 100.0) / 100.0, 0.001);

        // Original bill is untouched
        assertEquals(3529.0, traveling.getTotalAmount(), 0.001);
    }

    /**
     * CASE E: Task specific verification scenario:
     * 1. Vraj Panchal creates a ₹1,000 bill split equally between Vraj and Nidhi.
     *    Result: Nidhi owes Vraj ₹500.
     *    Group member Mehr Panchal is not in the split and owes ₹0.
     * 2. Nidhi Shah records a successful ₹500 settlement to Vraj.
     * 3. Assertions:
     *    - Group settlements list is empty (no remaining debts).
     *    - Nidhi balance is exactly 0.0 (no longer owes ₹500).
     *    - Vraj balance is exactly 0.0 (received the full amount).
     *    - Mehr balance remains 0.0.
     *    - Sum of all balances remains identically 0.0 (conservation of money).
     */
    @Test
    void testCaseE_vrajNidhiMehr_billAndSettlementSync() {
        String groupId = "group-sync-demo";
        Bill dinnerBill = bill("b-dinner", groupId, "vraj", 1000.0,
                List.of(item("Dinner", 1000.0, List.of("vraj", "nidhi"))));

        // Step 1: Before settlement
        when(billRepository.findByGroupId(groupId)).thenReturn(List.of(dinnerBill));
        when(settlementRecordRepository.findByGroupIdAndStatus(groupId, SettlementRecord.Status.PAID))
                .thenReturn(List.of());

        List<Settlement> preSettlements = service.getSettlementsForGroup(groupId);
        assertEquals(1, preSettlements.size(), "Before settlement, exactly 1 debt should exist");
        Settlement preDebt = preSettlements.get(0);
        assertEquals("nidhi", preDebt.getFromUserId());
        assertEquals("vraj", preDebt.getToUserId());
        assertEquals(500.0, preDebt.getAmount(), 0.001);

        Map<String, Double> preBalances = service.calculateRemainingNetBalancesForGroup(groupId);
        assertEquals(500.0, preBalances.get("vraj"), 0.001);
        assertEquals(-500.0, preBalances.get("nidhi"), 0.001);

        // Step 2: Nidhi records successful ₹500 settlement to Vraj
        SettlementRecord settlementRecord = new SettlementRecord();
        settlementRecord.setId("settle-1");
        settlementRecord.setGroupId(groupId);
        settlementRecord.setFromUserId("nidhi");
        settlementRecord.setToUserId("vraj");
        settlementRecord.setAmount(500.0);
        settlementRecord.setCurrency("INR");
        settlementRecord.setStatus(SettlementRecord.Status.PAID);

        when(settlementRecordRepository.findByGroupIdAndStatus(groupId, SettlementRecord.Status.PAID))
                .thenReturn(List.of(settlementRecord));

        // Step 3: Check post-settlement state for all group members (Vraj, Nidhi, Mehr)
        List<Settlement> postSettlements = service.getSettlementsForGroup(groupId);
        assertTrue(postSettlements.isEmpty(), "All debts in group must be settled; list must be empty");

        Map<String, Double> postBalances = service.calculateRemainingNetBalancesForGroup(groupId);
        assertEquals(0.0, postBalances.get("nidhi"), 0.001, "Nidhi must no longer owe ₹500 (balance == 0.0)");
        assertEquals(0.0, postBalances.get("vraj"), 0.001, "Vraj balance must be settled (balance == 0.0)");
        assertNull(postBalances.get("mehr"), "Mehr was not in bill so has no non-zero net balance");

        // Verify conservation of money
        double sum = postBalances.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(0.0, Math.round(sum * 100.0) / 100.0, 0.001, "Money conservation invariant preserved");
    }

    @Test
    void testNullHandling_corruptedBillRecordsWithNulls_doesNotThrow() {
        String groupId = "group-corrupted";
        Bill corruptedBill = new Bill();
        corruptedBill.setId("bill-corrupted");
        corruptedBill.setGroupId(groupId);
        corruptedBill.setPaidBy(null); // null payer

        BillItem itemWithNullPrice = new BillItem("Item 1", null, Arrays.asList("userA", null, "userB"), null);
        BillItem itemWithNegativePrice = new BillItem("Item 2", -10.0, Collections.singletonList("userA"), null);
        BillItem validItem = new BillItem("Item 3", 100.0, Arrays.asList("userA", "userB", null), null);

        corruptedBill.setItems(Arrays.asList(itemWithNullPrice, itemWithNegativePrice, validItem));

        when(billRepository.findByGroupId(groupId)).thenReturn(Collections.singletonList(corruptedBill));

        // Must not throw NullPointerException or IllegalArgumentException
        assertDoesNotThrow(() -> {
            List<Settlement> settlements = service.getSettlementsForGroup(groupId);
            assertNotNull(settlements);
        });
    }
}