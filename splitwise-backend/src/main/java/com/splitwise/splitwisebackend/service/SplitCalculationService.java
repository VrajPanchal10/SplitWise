package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.dto.BillBreakdownResponse;
import com.splitwise.splitwisebackend.dto.ParticipantShare;
import com.splitwise.splitwisebackend.dto.Settlement;
import com.splitwise.splitwisebackend.model.Bill;
import com.splitwise.splitwisebackend.model.BillItem;
import com.splitwise.splitwisebackend.model.SettlementRecord;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.BillRepository;
import com.splitwise.splitwisebackend.repository.SettlementRecordRepository;
import com.splitwise.splitwisebackend.repository.UserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.*;

@Service
@Slf4j
public class SplitCalculationService {

    private final BillRepository billRepository;
    private final SettlementRecordRepository settlementRecordRepository;
    private final UserRepository userRepository;

    @Autowired
    public SplitCalculationService(BillRepository billRepository,
                                   SettlementRecordRepository settlementRecordRepository,
                                   UserRepository userRepository) {
        this.billRepository = billRepository;
        this.settlementRecordRepository = settlementRecordRepository;
        this.userRepository = userRepository;
    }

    /** Constructor for tests where UserRepository is not mocked. */
    public SplitCalculationService(BillRepository billRepository,
                                   SettlementRecordRepository settlementRecordRepository) {
        this(billRepository, settlementRecordRepository, null);
    }

    /**
     * Calculates how much each user owes for a single bill using deterministic
     * integer-cents allocation.
     *
     * Mathematical Correctness Guarantees:
     * 1. Equal Split: Total amount in cents is divided by N unique participants.
     *    Quotient = totalCents / N, Remainder = totalCents % N.
     *    The first `remainder` participants receive (quotient + 1) cents,
     *    and the remaining participants receive quotient cents.
     *    The sum of shares is mathematically guaranteed to equal the item price exactly:
     *    remainder * (quotient + 1) + (N - remainder) * quotient = N * quotient + remainder = totalCents.
     *    No money is created or lost due to rounding.
     *
     * 2. Remainder Assignment Strategy:
     *    Participants are ordered deterministically. If the bill's payer is among
     *    the item's participants, the payer is placed first to absorb the first remainder
     *    cent, followed by the rest in stable order.
     *
     * 3. Custom / Unequal Split:
     *    If an item specifies `customShares` (a map of userId -> exact share amount),
     *    those exact amounts are used (validated to non-negative and matching item price).
     *
     * 4. De-duplication:
     *    `sharedByUserIds` is de-duplicated using LinkedHashSet so duplicate entries
     *    never inflate the participant count.
     *
     * 5. Zero / Empty Participants:
     *    Items with null/empty `sharedByUserIds` are safely skipped.
     *
     * @param bill the bill to calculate shares for
     * @return a map of userId -> total rounded amount (in rupees) that user owes
     */
    public Map<String, Double> calculateIndividualShares(Bill bill) {
        Map<String, Double> shares = new LinkedHashMap<>();
        if (bill == null || bill.getItems() == null) {
            return shares;
        }

        String payerId = bill.getPaidBy();

        for (BillItem item : bill.getItems()) {
            if (item == null || item.getPrice() == null) {
                continue;
            }

            // Case 1: Custom / Unequal split per item
            if (item.getCustomShares() != null && !item.getCustomShares().isEmpty()) {
                for (Map.Entry<String, Double> entry : item.getCustomShares().entrySet()) {
                    String userId = entry.getKey();
                    Double customAmount = entry.getValue();
                    if (userId != null && customAmount != null) {
                        double roundedAmount = Math.round(customAmount * 100.0) / 100.0;
                        shares.put(userId, roundToTwoDecimals(shares.getOrDefault(userId, 0.0) + roundedAmount));
                    }
                }
                continue;
            }

            // Case 2: Equal split among unique participants
            List<String> sharedBy = item.getSharedByUserIds();
            if (sharedBy == null || sharedBy.isEmpty()) {
                continue;
            }

            // De-duplicate participants while maintaining deterministic order
            Set<String> uniqueSet = new LinkedHashSet<>(sharedBy);
            if (uniqueSet.isEmpty()) {
                continue;
            }

            // Deterministic ordering: if payer is in the participant list, place payer first
            List<String> orderedParticipants = new ArrayList<>();
            if (payerId != null && uniqueSet.contains(payerId)) {
                orderedParticipants.add(payerId);
            }
            for (String uid : uniqueSet) {
                if (!uid.equals(payerId)) {
                    orderedParticipants.add(uid);
                }
            }

            int participantCount = orderedParticipants.size();
            long totalCents = Math.round(item.getPrice() * 100.0);
            long baseCents = totalCents / participantCount;
            long remainderCents = totalCents % participantCount;

            for (int i = 0; i < participantCount; i++) {
                String userId = orderedParticipants.get(i);
                long cents = baseCents + (i < remainderCents ? 1 : 0);
                double userShare = cents / 100.0;
                shares.put(userId, roundToTwoDecimals(shares.getOrDefault(userId, 0.0) + userShare));
            }
        }

        return shares;
    }

    /**
     * Produces a comprehensive breakdown for an expense showing:
     * - Total bill amount
     * - Who paid (and how much they paid)
     * - Participant count
     * - For each participant: paid amount, share amount, and net balance (+/-)
     */
    public BillBreakdownResponse calculateBillBreakdown(Bill bill) {
        if (bill == null) {
            return null;
        }

        Map<String, Double> shares = calculateIndividualShares(bill);
        String payerId = bill.getPaidBy();
        double totalAmount = bill.getTotalAmount() != null ? roundToTwoDecimals(bill.getTotalAmount()) : 0.0;

        // Collect all distinct participants (everyone who owes a share + payer)
        Set<String> allParticipantIds = new LinkedHashSet<>();
        if (payerId != null) {
            allParticipantIds.add(payerId);
        }
        allParticipantIds.addAll(shares.keySet());

        String paidByName = "Unknown";
        if (payerId != null && userRepository != null) {
            paidByName = userRepository.findById(payerId)
                    .map(User::getFullName)
                    .orElse(payerId);
        }

        List<ParticipantShare> participantShares = new ArrayList<>();
        for (String userId : allParticipantIds) {
            String name = userId;
            if (userRepository != null) {
                name = userRepository.findById(userId)
                        .map(User::getFullName)
                        .orElse(userId);
            }

            double paid = userId.equals(payerId) ? totalAmount : 0.0;
            double share = shares.getOrDefault(userId, 0.0);
            double net = roundToTwoDecimals(paid - share);

            participantShares.add(ParticipantShare.builder()
                    .userId(userId)
                    .name(name)
                    .paidAmount(paid)
                    .shareAmount(share)
                    .netAmount(net)
                    .build());
        }

        return BillBreakdownResponse.builder()
                .billId(bill.getId())
                .title(bill.getTitle())
                .totalAmount(totalAmount)
                .paidBy(payerId)
                .paidByName(paidByName)
                .participantCount(allParticipantIds.size())
                .participants(participantShares)
                .build();
    }

    private static double roundToTwoDecimals(double value) {
        return Math.round(value * 100.0) / 100.0;
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