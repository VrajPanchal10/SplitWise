package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.dto.Settlement;
import com.splitwise.splitwisebackend.model.Bill;
import com.splitwise.splitwisebackend.model.BillItem;
import com.splitwise.splitwisebackend.model.SettlementRecord;
import com.splitwise.splitwisebackend.repository.BillRepository;
import com.splitwise.splitwisebackend.repository.SettlementRecordRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class SplitCalculationService {

    private final BillRepository billRepository;
    private final SettlementRecordRepository settlementRecordRepository;

    /**
     * Calculates how much each user owes for a single bill.
     * For each BillItem, the price is divided equally among all UNIQUE users
     * listed in sharedByUserIds.
     *
     * IMPORTANT: sharedByUserIds is de-duplicated before dividing. If the same
     * user appears twice (e.g. the payer was pre-selected as a group member AND
     * added explicitly), the price must still be divided by the number of
     * UNIQUE people, not by the raw list size.
     *
     * Example: item price 200, sharedByUserIds = [Harsh, Kiran, Harsh]
     * (2 people, 3 entries). Each person's share must be 100.0, NOT 66.67.
     * Without de-duplication the incorrect 200 / 3 = 66.67 would be used.
     *
     * @param bill the bill to calculate shares for
     * @return a map of userId -> total amount that user owes
     */
    public Map<String, Double> calculateIndividualShares(Bill bill) {
        Map<String, Double> shares = new HashMap<>();

        for (BillItem item : bill.getItems()) {
            List<String> sharedBy = item.getSharedByUserIds();
            if (sharedBy == null || sharedBy.isEmpty()) {
                continue;
            }

            // De-duplicate — duplicates must NOT inflate the split count.
            Set<String> uniqueSharedBy = new LinkedHashSet<>(sharedBy);
            if (uniqueSharedBy.isEmpty()) {
                continue;
            }

            double sharePerUser = item.getPrice() / uniqueSharedBy.size();

            for (String userId : uniqueSharedBy) {
                shares.put(userId, shares.getOrDefault(userId, 0.0) + sharePerUser);
            }
        }

        return shares;
    }

    /**
     * Simplifies debts using a GREEDY two-pointer algorithm.
     *
     * The classic "minimum cash flow" problem: given a set of users with
     * positive balances (creditors - owed money) and negative balances
     * (debtors - owe money), find the minimum number of transactions
     * to settle all debts.
     *
     * Algorithm:
     * 1. Separate users into creditors (positive balance) and debtors (negative balance)
     * 2. Sort creditors by balance descending (largest creditor first)
     * 3. Sort debtors by balance ascending (most negative debtor first)
     * 4. Use two pointers: match the largest creditor with the largest debtor
     * 5. Settle the smaller of the two absolute amounts between them
     * 6. Reduce both balances accordingly; advance the pointer whose balance
     *    reaches zero
     * 7. Continue until all balances are effectively zero
     *
     * This greedy approach minimizes the number of transactions because it
     * always settles the maximum possible amount in each transaction.
     *
     * @param netBalances map of userId -> net amount (positive = owed, negative = owes)
     * @return list of Settlement objects representing who pays whom
     */
    public List<Settlement> simplifyDebts(Map<String, Double> netBalances) {
        List<Settlement> settlements = new ArrayList<>();

        // Separate creditors (positive balance) and debtors (negative balance)
        List<Map.Entry<String, Double>> creditors = new ArrayList<>();
        List<Map.Entry<String, Double>> debtors = new ArrayList<>();

        for (Map.Entry<String, Double> entry : netBalances.entrySet()) {
            double balance = entry.getValue();
            if (balance > 0.01) {
                creditors.add(entry);
            } else if (balance < -0.01) {
                debtors.add(entry);
            }
        }

        // Sort creditors by balance descending (largest creditor first)
        creditors.sort((a, b) -> Double.compare(b.getValue(), a.getValue()));

        // Sort debtors by balance ascending (most negative debtor first)
        debtors.sort(Comparator.comparingDouble(Map.Entry::getValue));

        // Two-pointer approach: match largest creditor with largest debtor
        int creditorPtr = 0;
        int debtorPtr = 0;

        while (creditorPtr < creditors.size() && debtorPtr < debtors.size()) {
            Map.Entry<String, Double> creditor = creditors.get(creditorPtr);
            Map.Entry<String, Double> debtor = debtors.get(debtorPtr);

            double creditorBalance = creditor.getValue();
            double debtorBalance = -debtor.getValue(); // convert to positive

            // Settle the smaller of the two amounts
            double settlementAmount = Math.min(creditorBalance, debtorBalance);

            // Round to 2 decimal places to avoid floating point issues
            settlementAmount = Math.round(settlementAmount * 100.0) / 100.0;

            settlements.add(new Settlement(
                    debtor.getKey(),  // fromUserId (the one who owes)
                    creditor.getKey(), // toUserId (the one who is owed)
                    settlementAmount
            ));

            // Reduce both balances
            creditor.setValue(creditorBalance - settlementAmount);
            debtor.setValue(-debtorBalance + settlementAmount);

            // Move pointers forward if balance reaches zero
            if (Math.abs(creditor.getValue()) < 0.01) {
                creditorPtr++;
            }
            if (Math.abs(debtor.getValue()) < 0.01) {
                debtorPtr++;
            }
        }

        return settlements;
    }

    /**
     * Calculates the net balance for every user in a group.
     *
     * Positive balance = the user is owed money (paid more than their share).
     * Negative balance = the user owes money (owes more than they paid).
     *
     * Personal expenses (bills with no groupId, OR bills where all items have
     * at most one UNIQUE participant) are COMPLETELY excluded from any
     * debt/settlement math — they are personal records and must contribute
     * exactly ₹0 to every balance.
     *
     * In debug mode, this logs every bill considered for the balance along
     * with its contribution so the math can be verified end-to-end.
     *
     * This method is intentionally public so it can be unit-tested directly.
     *
     * @param groupId the group to calculate balances for
     * @return map of userId -> net balance (positive = owed, negative = owes)
     */
    public Map<String, Double> calculateNetBalancesForGroup(String groupId) {
        List<Bill> bills = billRepository.findByGroupId(groupId);
        Map<String, Double> netBalances = new HashMap<>();

        for (Bill bill : bills) {
            // Personal expenses are COMPLETELY excluded from debt/settlement math.
            if (isPersonalExpense(bill)) {
                log.debug("[SplitCalculation] Excluded personal bill from balance math: id={}, title={}, total={}, groupId={}, paidBy={}",
                        bill.getId(), bill.getTitle(), bill.getTotalAmount(), bill.getGroupId(), bill.getPaidBy());
                continue;
            }

            // The person who paid is credited with the total amount
            String paidBy = bill.getPaidBy();
            double credited = bill.getTotalAmount() != null ? bill.getTotalAmount() : 0.0;
            netBalances.put(paidBy, netBalances.getOrDefault(paidBy, 0.0) + credited);

            // Each UNIQUE person who shared items is debited their share
            Map<String, Double> shares = calculateIndividualShares(bill);
            for (Map.Entry<String, Double> entry : shares.entrySet()) {
                String userId = entry.getKey();
                double share = entry.getValue();
                netBalances.put(userId, netBalances.getOrDefault(userId, 0.0) - share);
            }

            log.debug("[SplitCalculation] Included group bill in balance math: id={}, title={}, total={}, paidBy={}, perUserShares={}",
                    bill.getId(), bill.getTitle(), credited, paidBy, shares);
        }

        log.debug("[SplitCalculation] Net balances for group {}: {}", groupId, netBalances);
        return netBalances;
    }

    /**
     * Calculates all settlements needed for a group and persists them to the database.
     *
     * For each bill in the group:
     * - The person who paid (paidBy) is credited with the total amount
     * - Each person who shared items is debited their share
     *
     * Then simplifyDebts() is called to minimize the number of transactions.
     * The calculated settlements are saved/updated in the database.
     *
     * Personal expenses are excluded entirely (see
     * {@link #calculateNetBalancesForGroup(String)}).
     *
     * @param groupId the group to calculate settlements for
     * @return list of Settlement objects representing the simplified debt structure
     */
    public List<Settlement> getSettlementsForGroup(String groupId) {
        Map<String, Double> netBalances = calculateNetBalancesForGroup(groupId);

        // Subtract already-PAID settlement amounts from net balances so
        // settled debts don't get recalculated as still owing.
        List<SettlementRecord> paidSettlements = settlementRecordRepository
                .findByGroupIdAndStatus(groupId, SettlementRecord.Status.PAID);
        for (SettlementRecord paid : paidSettlements) {
            if (paid.getFromUserId() != null && paid.getToUserId() != null && paid.getAmount() != null) {
                // The debtor (fromUserId) already paid this amount to the creditor (toUserId)
                netBalances.merge(paid.getFromUserId(), paid.getAmount(), Double::sum);
                netBalances.merge(paid.getToUserId(), -paid.getAmount(), Double::sum);
            }
        }

        // Simplify debts to minimize number of transactions
        List<Settlement> settlements = simplifyDebts(netBalances);

        // Persist settlements to database
        persistSettlements(groupId, settlements);

        return settlements;
    }

    /**
     * Checks if a bill is a personal expense (no group, or only one UNIQUE
     * participant). Personal expenses don't generate settlements since there's
     * no one else to owe/be owed.
     *
     * The participant set is de-duplicated before counting, so a list like
     * [Harsh, Kiran, Harsh] counts as 2 unique participants, and [Harsh, Harsh]
     * counts as 1 (a personal expense).
     *
     * @param bill the bill to check
     * @return true if the bill is a personal expense
     */
    public boolean isPersonalExpense(Bill bill) {
        // If the bill has no groupId, it's a personal expense
        if (bill.getGroupId() == null || bill.getGroupId().isEmpty()) {
            return true;
        }

        // Collect all unique participant IDs from all items
        Set<String> participants = new HashSet<>();
        for (BillItem item : bill.getItems()) {
            if (item.getSharedByUserIds() != null) {
                participants.addAll(item.getSharedByUserIds());
            }
        }

        // If there's only one unique participant, it's a personal expense
        return participants.size() <= 1;
    }

    /**
     * Persists settlements to the database. Updates existing PENDING settlements
     * or creates new ones.
     *
     * @param groupId the group ID
     * @param settlements list of settlements to persist
     */
    private void persistSettlements(String groupId, List<Settlement> settlements) {
        // Delete existing PENDING settlements for this group
        List<SettlementRecord> existingPending = settlementRecordRepository.findByGroupIdAndStatus(groupId, SettlementRecord.Status.PENDING);
        settlementRecordRepository.deleteAll(existingPending);

        // Create new settlement records
        LocalDateTime now = LocalDateTime.now();
        for (Settlement settlement : settlements) {
            SettlementRecord record = new SettlementRecord();
            record.setGroupId(groupId);
            record.setFromUserId(settlement.getFromUserId());
            record.setToUserId(settlement.getToUserId());
            record.setAmount(settlement.getAmount());
            record.setStatus(SettlementRecord.Status.PENDING);
            record.setCreatedAt(now);
            record.setPaidAt(null);
            settlementRecordRepository.save(record);
        }
    }
}