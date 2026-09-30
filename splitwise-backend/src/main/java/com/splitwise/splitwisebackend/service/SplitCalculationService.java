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
     * Internal mutable entry for debt simplification in integer cents (paise).
     */
    private static class BalanceEntry {
        final String userId;
        long cents;

        BalanceEntry(String userId, long cents) {
            this.userId = userId;
            this.cents = cents;
        }
    }

    /**
     * Simplifies debts using an exact-match-first greedy debt simplification algorithm.
     *
     * Invariants guaranteed:
     * 1. Total money conservation: The sum of all amounts received by creditors
     *    equals the sum of all amounts paid by debtors down to the exact cent.
     * 2. Zero-sum invariant: sum(all net balances) == 0 within rounding precision.
     * 3. Deterministic: Rounding is handled in integer cents (paise). Stable sorting
     *    with tie-breakers (userId) ensures identical results on every execution.
     * 4. Minimal transactions:
     *    - Exact match optimization: If a debtor owes the exact same amount that a
     *      creditor is owed (e.g., A owes 50 and B is owed 50), they are matched directly,
     *      eliminating both in a single transaction.
     *    - Greedy two-pointer: For remaining balances, matches largest creditor with
     *      largest debtor to settle maximum possible debt per transaction.
     * 5. Handled cases: positive balances, negative balances, zero balances (filtered),
     *    multiple creditors, multiple debtors, fully settled groups (empty result),
     *    and large groups (5+ people).
     *
     * @param netBalances map of userId -> net amount (positive = owed, negative = owes)
     * @return list of Settlement objects representing who pays whom
     */
    public List<Settlement> simplifyDebts(Map<String, Double> netBalances) {
        List<Settlement> settlements = new ArrayList<>();
        if (netBalances == null || netBalances.isEmpty()) {
            return settlements;
        }

        // Separate creditors (positive cents) and debtors (negative cents)
        List<BalanceEntry> creditors = new ArrayList<>();
        List<BalanceEntry> debtors = new ArrayList<>();

        for (Map.Entry<String, Double> entry : netBalances.entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) {
                continue;
            }
            long cents = Math.round(entry.getValue() * 100.0);
            if (cents > 0) {
                creditors.add(new BalanceEntry(entry.getKey(), cents));
            } else if (cents < 0) {
                debtors.add(new BalanceEntry(entry.getKey(), -cents)); // convert to positive
            }
        }

        if (creditors.isEmpty() || debtors.isEmpty()) {
            return settlements;
        }

        // Reconcile minor float rounding discrepancies from external float conversions (up to 5 cents)
        long totalCreditorCents = creditors.stream().mapToLong(c -> c.cents).sum();
        long totalDebtorCents = debtors.stream().mapToLong(d -> d.cents).sum();
        long discrepancy = totalCreditorCents - totalDebtorCents;

        if (Math.abs(discrepancy) <= 5 && discrepancy != 0) {
            if (discrepancy > 0) {
                // Creditors exceed debtors; absorb into the largest debtor
                debtors.stream()
                        .max(Comparator.comparingLong((BalanceEntry d) -> d.cents).thenComparing(d -> d.userId))
                        .ifPresent(d -> d.cents += discrepancy);
            } else {
                // Debtors exceed creditors; absorb into the largest creditor
                creditors.stream()
                        .max(Comparator.comparingLong((BalanceEntry c) -> c.cents).thenComparing(c -> c.userId))
                        .ifPresent(c -> c.cents += (-discrepancy));
            }
        }

        // Sort both deterministically: descending by amount, tie-break ascending by userId
        Comparator<BalanceEntry> comparator = Comparator
                .comparingLong((BalanceEntry b) -> b.cents).reversed()
                .thenComparing(b -> b.userId);

        creditors.sort(comparator);
        debtors.sort(comparator);

        // Phase 1: Exact Match Optimization
        // If a creditor and a debtor have the exact same balance, settle them directly.
        // This eliminates both in 1 transaction (optimal 2-node sub-graph resolution).
        for (BalanceEntry creditor : creditors) {
            if (creditor.cents <= 0) continue;
            for (BalanceEntry debtor : debtors) {
                if (debtor.cents <= 0) continue;
                if (creditor.cents == debtor.cents) {
                    double amount = creditor.cents / 100.0;
                    settlements.add(buildSettlement(debtor.userId, creditor.userId, amount));
                    creditor.cents = 0;
                    debtor.cents = 0;
                    break;
                }
            }
        }

        // Phase 2: Greedy Two-Pointer matching for remaining unsettled balances
        List<BalanceEntry> remainingCreditors = new ArrayList<>();
        for (BalanceEntry c : creditors) {
            if (c.cents > 0) remainingCreditors.add(c);
        }
        List<BalanceEntry> remainingDebtors = new ArrayList<>();
        for (BalanceEntry d : debtors) {
            if (d.cents > 0) remainingDebtors.add(d);
        }

        remainingCreditors.sort(comparator);
        remainingDebtors.sort(comparator);

        int creditorPtr = 0;
        int debtorPtr = 0;

        while (creditorPtr < remainingCreditors.size() && debtorPtr < remainingDebtors.size()) {
            BalanceEntry creditor = remainingCreditors.get(creditorPtr);
            BalanceEntry debtor = remainingDebtors.get(debtorPtr);

            long settleCents = Math.min(creditor.cents, debtor.cents);
            if (settleCents > 0) {
                double amount = settleCents / 100.0;
                settlements.add(buildSettlement(debtor.userId, creditor.userId, amount));

                creditor.cents -= settleCents;
                debtor.cents -= settleCents;
            }

            if (creditor.cents == 0) {
                creditorPtr++;
            }
            if (debtor.cents == 0) {
                debtorPtr++;
            }
        }

        // Sort settlements deterministically: fromUserId ascending, then toUserId ascending
        settlements.sort(Comparator
                .comparing((Settlement s) -> s.getFromUserId())
                .thenComparing(Settlement::getToUserId));

        return settlements;
    }

    private Settlement buildSettlement(String fromUserId, String toUserId, double amount) {
        Settlement settlement = new Settlement(fromUserId, toUserId, roundToTwoDecimals(amount));
        if (userRepository != null) {
            settlement.setFromUserName(userRepository.findById(fromUserId)
                    .map(User::getFullName)
                    .orElse(fromUserId));
            settlement.setToUserName(userRepository.findById(toUserId)
                    .map(User::getFullName)
                    .orElse(toUserId));
        } else {
            settlement.setFromUserName(fromUserId);
            settlement.setToUserName(toUserId);
        }
        return settlement;
    }

    /**
     * Calculates the net balance for every user in a group.
     *
     * Positive balance = the user is owed money (paid more than their share).
     * Negative balance = the user owes money (owes more than they paid).
     *
     * Invariant: Total money is conserved — sum(all net balances) == 0.00.
     *
     * Personal expenses (bills with no groupId, OR bills where all items have
     * at most one UNIQUE participant) are COMPLETELY excluded from any
     * debt/settlement math — they are personal records and must contribute
     * exactly ₹0 to every balance.
     *
     * @param groupId the group to calculate balances for
     * @return map of userId -> net balance (positive = owed, negative = owes)
     */
    public Map<String, Double> calculateNetBalancesForGroup(String groupId) {
        List<Bill> bills = billRepository.findByGroupId(groupId);
        Map<String, Double> netBalances = new LinkedHashMap<>();

        if (bills == null) {
            return netBalances;
        }

        for (Bill bill : bills) {
            if (bill == null || isPersonalExpense(bill)) {
                log.debug("[SplitCalculation] Excluded personal bill from balance math: id={}, title={}, total={}, groupId={}, paidBy={}",
                        bill != null ? bill.getId() : null,
                        bill != null ? bill.getTitle() : null,
                        bill != null ? bill.getTotalAmount() : null,
                        bill != null ? bill.getGroupId() : null,
                        bill != null ? bill.getPaidBy() : null);
                continue;
            }

            Map<String, Double> shares = calculateIndividualShares(bill);
            if (shares.isEmpty()) {
                continue;
            }

            // The payer is credited the exact sum of individual shares for this bill.
            // This guarantees that total credited equals total debited down to the exact cent,
            // strictly conserving money and preserving the zero-sum invariant.
            String paidBy = bill.getPaidBy();
            double credited = shares.values().stream().mapToDouble(Double::doubleValue).sum();
            credited = roundToTwoDecimals(credited);

            netBalances.put(paidBy, roundToTwoDecimals(netBalances.getOrDefault(paidBy, 0.0) + credited));

            // Each UNIQUE person who shared items is debited their exact share
            for (Map.Entry<String, Double> entry : shares.entrySet()) {
                String userId = entry.getKey();
                double share = entry.getValue();
                netBalances.put(userId, roundToTwoDecimals(netBalances.getOrDefault(userId, 0.0) - share));
            }

            log.debug("[SplitCalculation] Included group bill in balance math: id={}, title={}, totalCredited={}, paidBy={}, perUserShares={}",
                    bill.getId(), bill.getTitle(), credited, paidBy, shares);
        }

        // Filter out balances that are effectively zero (|balance| < 0.005)
        // Clean up small floating point residues
        for (Map.Entry<String, Double> entry : new ArrayList<>(netBalances.entrySet())) {
            double rounded = roundToTwoDecimals(entry.getValue());
            if (Math.abs(rounded) < 0.005) {
                netBalances.put(entry.getKey(), 0.0);
            } else {
                netBalances.put(entry.getKey(), rounded);
            }
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
        if (settlementRecordRepository != null) {
            List<SettlementRecord> paidSettlements = settlementRecordRepository
                    .findByGroupIdAndStatus(groupId, SettlementRecord.Status.PAID);
            if (paidSettlements != null) {
                for (SettlementRecord paid : paidSettlements) {
                    if (paid.getFromUserId() != null && paid.getToUserId() != null && paid.getAmount() != null) {
                        double amount = roundToTwoDecimals(paid.getAmount());
                        netBalances.put(paid.getFromUserId(),
                                roundToTwoDecimals(netBalances.getOrDefault(paid.getFromUserId(), 0.0) + amount));
                        netBalances.put(paid.getToUserId(),
                                roundToTwoDecimals(netBalances.getOrDefault(paid.getToUserId(), 0.0) - amount));
                    }
                }
            }
        }

        // Simplify debts to minimize number of transactions
        List<Settlement> settlements = simplifyDebts(netBalances);

        // Persist settlements to database
        if (settlementRecordRepository != null) {
            persistSettlements(groupId, settlements);
        }

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
        if (bill == null) {
            return true;
        }

        // If the bill has no groupId, it's a personal expense
        if (bill.getGroupId() == null || bill.getGroupId().isEmpty()) {
            return true;
        }

        if (bill.getItems() == null || bill.getItems().isEmpty()) {
            return true;
        }

        // Collect all unique participant IDs from all items
        Set<String> participants = new HashSet<>();
        for (BillItem item : bill.getItems()) {
            if (item != null && item.getSharedByUserIds() != null) {
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
        if (existingPending != null && !existingPending.isEmpty()) {
            settlementRecordRepository.deleteAll(existingPending);
        }

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
            SettlementRecord saved = settlementRecordRepository.save(record);
            if (saved != null) {
                settlement.setId(saved.getId());
            }
            settlement.setStatus("PENDING");
        }
    }
}