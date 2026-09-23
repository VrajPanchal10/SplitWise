package com.splitwise.splitwisebackend.service;

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
}