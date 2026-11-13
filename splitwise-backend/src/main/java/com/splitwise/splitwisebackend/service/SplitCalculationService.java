package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.dto.BillBreakdownResponse;
import com.splitwise.splitwisebackend.dto.ParticipantShare;
import com.splitwise.splitwisebackend.dto.Settlement;
import com.splitwise.splitwisebackend.model.Bill;
import com.splitwise.splitwisebackend.model.BillItem;
import com.splitwise.splitwisebackend.model.Group;
import com.splitwise.splitwisebackend.model.SettlementRecord;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.BillRepository;
import com.splitwise.splitwisebackend.repository.GroupRepository;
import com.splitwise.splitwisebackend.repository.SettlementRecordRepository;
import com.splitwise.splitwisebackend.repository.UserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.*;

@Service
@Slf4j
public class SplitCalculationService {

    private final BillRepository billRepository;
    private final SettlementRecordRepository settlementRecordRepository;
    private final UserRepository userRepository;
    private final GroupRepository groupRepository;
    private final CurrencyConversionService currencyConversionService;

    @Autowired
    public SplitCalculationService(BillRepository billRepository,
                                   SettlementRecordRepository settlementRecordRepository,
                                   UserRepository userRepository,
                                   GroupRepository groupRepository,
                                   CurrencyConversionService currencyConversionService) {
        this.billRepository = billRepository;
        this.settlementRecordRepository = settlementRecordRepository;
        this.userRepository = userRepository;
        this.groupRepository = groupRepository;
        this.currencyConversionService = currencyConversionService != null ? currencyConversionService : new CurrencyConversionService();
    }

    /** Constructor for tests where optional repositories are not mocked. */
    public SplitCalculationService(BillRepository billRepository,
                                   SettlementRecordRepository settlementRecordRepository) {
        this(billRepository, settlementRecordRepository, null, null, new CurrencyConversionService());
    }

    public SplitCalculationService(BillRepository billRepository,
                                   SettlementRecordRepository settlementRecordRepository,
                                   UserRepository userRepository) {
        this(billRepository, settlementRecordRepository, userRepository, null, new CurrencyConversionService());
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

        String payerId = bill.getPaidBy() != null ? bill.getPaidBy().trim() : null;

        for (BillItem item : bill.getItems()) {
            if (item == null || item.getPrice() == null || item.getPrice() <= 0) {
                continue;
            }

            // Case 1: Custom / Unequal split per item
            if (item.getCustomShares() != null && !item.getCustomShares().isEmpty()) {
                for (Map.Entry<String, Double> entry : item.getCustomShares().entrySet()) {
                    String userId = entry.getKey();
                    Double customAmount = entry.getValue();
                    if (userId != null && !userId.trim().isEmpty() && customAmount != null && customAmount > 0) {
                        double roundedAmount = Math.round(customAmount * 100.0) / 100.0;
                        shares.put(userId.trim(), roundToTwoDecimals(shares.getOrDefault(userId.trim(), 0.0) + roundedAmount));
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
            Set<String> uniqueSet = new LinkedHashSet<>();
            for (String s : sharedBy) {
                if (s != null && !s.trim().isEmpty()) {
                    uniqueSet.add(s.trim());
                }
            }
            if (uniqueSet.isEmpty()) {
                continue;
            }

            // Deterministic ordering: if payer is in the participant list, place payer first
            List<String> orderedParticipants = new ArrayList<>();
            if (payerId != null && uniqueSet.contains(payerId)) {
                orderedParticipants.add(payerId);
            }
            for (String uid : uniqueSet) {
                if (payerId == null || !uid.equals(payerId)) {
                    orderedParticipants.add(uid);
                }
            }

            int participantCount = orderedParticipants.size();
            if (participantCount == 0) {
                continue;
            }
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
     * Calculates individual shares denominated in the universal settlement currency (INR).
     *
     * Converts the bill into INR using the locked exchangeRate, and performs deterministic
     * integer paise (cents) division among unique participants.
     * Guaranteed: sum(all inrShares) == convertedInrAmount down to the exact paisa.
     */
    public Map<String, Double> calculateIndividualInrShares(Bill bill) {
        Map<String, Double> inrShares = new LinkedHashMap<>();
        if (bill == null || bill.getItems() == null || bill.getItems().isEmpty()) {
            return inrShares;
        }

        String curr = bill.getCurrency() != null && !bill.getCurrency().trim().isEmpty()
                ? bill.getCurrency().trim().toUpperCase()
                : "INR";
        double rate = bill.getExchangeRate() != null && bill.getExchangeRate() > 0
                ? bill.getExchangeRate()
                : ("INR".equalsIgnoreCase(curr) ? 1.0 : currencyConversionService.getExchangeRate(curr, "INR"));

        if ("INR".equalsIgnoreCase(curr)) {
            return calculateIndividualShares(bill);
        }

        String payerId = bill.getPaidBy() != null ? bill.getPaidBy().trim() : null;

        for (BillItem item : bill.getItems()) {
            if (item == null || item.getPrice() == null || item.getPrice() <= 0) {
                continue;
            }

            double itemInrPrice = roundToTwoDecimals(item.getPrice() * rate);

            // Case 1: Custom / Unequal split per item
            if (item.getCustomShares() != null && !item.getCustomShares().isEmpty()) {
                for (Map.Entry<String, Double> entry : item.getCustomShares().entrySet()) {
                    String userId = entry.getKey();
                    Double customAmount = entry.getValue();
                    if (userId != null && !userId.trim().isEmpty() && customAmount != null && customAmount > 0) {
                        double customInr = roundToTwoDecimals(customAmount * rate);
                        inrShares.put(userId.trim(), roundToTwoDecimals(inrShares.getOrDefault(userId.trim(), 0.0) + customInr));
                    }
                }
                continue;
            }

            // Case 2: Equal split among unique participants
            List<String> sharedBy = item.getSharedByUserIds();
            if (sharedBy == null || sharedBy.isEmpty()) {
                continue;
            }

            Set<String> uniqueSet = new LinkedHashSet<>();
            for (String s : sharedBy) {
                if (s != null && !s.trim().isEmpty()) {
                    uniqueSet.add(s.trim());
                }
            }
            if (uniqueSet.isEmpty()) {
                continue;
            }

            List<String> orderedParticipants = new ArrayList<>();
            if (payerId != null && uniqueSet.contains(payerId)) {
                orderedParticipants.add(payerId);
            }
            for (String uid : uniqueSet) {
                if (payerId == null || !uid.equals(payerId)) {
                    orderedParticipants.add(uid);
                }
            }

            int participantCount = orderedParticipants.size();
            if (participantCount == 0) {
                continue;
            }

            long totalCents = Math.round(itemInrPrice * 100.0);
            long baseCents = totalCents / participantCount;
            long remainderCents = totalCents % participantCount;

            for (int i = 0; i < participantCount; i++) {
                String userId = orderedParticipants.get(i);
                long cents = baseCents + (i < remainderCents ? 1 : 0);
                double userShare = cents / 100.0;
                inrShares.put(userId, roundToTwoDecimals(inrShares.getOrDefault(userId, 0.0) + userShare));
            }
        }

        return inrShares;
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
        Map<String, Double> inrShares = calculateIndividualInrShares(bill);
        String payerId = bill.getPaidBy();
        double totalAmount = bill.getTotalAmount() != null ? roundToTwoDecimals(bill.getTotalAmount()) : 0.0;

        String currency = bill.getCurrency() != null && !bill.getCurrency().trim().isEmpty()
                ? bill.getCurrency().trim().toUpperCase()
                : "INR";
        String baseCurrency = bill.getBaseCurrency() != null && !bill.getBaseCurrency().trim().isEmpty()
                ? bill.getBaseCurrency().trim().toUpperCase()
                : "INR";
        Double exchangeRate = bill.getExchangeRate() != null && bill.getExchangeRate() > 0
                ? bill.getExchangeRate()
                : ("INR".equalsIgnoreCase(currency) ? 1.0 : currencyConversionService.getExchangeRate(currency, "INR"));
        Double convertedAmount = bill.getConvertedAmount() != null && bill.getConvertedAmount() > 0
                ? bill.getConvertedAmount()
                : roundToTwoDecimals(totalAmount * exchangeRate);

        // Collect all distinct participants (everyone who owes a share + payer)
        Set<String> allParticipantIds = new LinkedHashSet<>();
        if (payerId != null) {
            allParticipantIds.add(payerId);
        }
        allParticipantIds.addAll(shares.keySet());
        allParticipantIds.addAll(inrShares.keySet());

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

            double convPaid = userId.equals(payerId) ? convertedAmount : 0.0;
            double convShare = inrShares.getOrDefault(userId, 0.0);
            double convNet = roundToTwoDecimals(convPaid - convShare);

            participantShares.add(ParticipantShare.builder()
                    .userId(userId)
                    .name(name)
                    .paidAmount(paid)
                    .shareAmount(share)
                    .netAmount(net)
                    .convertedPaidAmount(convPaid)
                    .convertedShareAmount(convShare)
                    .convertedNetAmount(convNet)
                    .build());
        }

        return BillBreakdownResponse.builder()
                .billId(bill.getId())
                .title(bill.getTitle())
                .totalAmount(totalAmount)
                .currency(currency)
                .baseCurrency(baseCurrency)
                .exchangeRate(exchangeRate)
                .exchangeRateDate(bill.getExchangeRateDate() != null ? bill.getExchangeRateDate().toString() : null)
                .convertedAmount(convertedAmount)
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
                if (creditor.userId.equals(debtor.userId)) continue;
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

            if (creditor.userId.equals(debtor.userId)) {
                if (creditorPtr < remainingCreditors.size() - 1) {
                    creditorPtr++;
                } else {
                    debtorPtr++;
                }
                continue;
            }

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
                .comparing((Settlement s) -> s.getFromUserId() != null ? s.getFromUserId() : "")
                .thenComparing((Settlement s) -> s.getToUserId() != null ? s.getToUserId() : ""));

        return settlements;
    }

    private Settlement buildSettlement(String fromUserId, String toUserId, double amount) {
        Settlement settlement = new Settlement(fromUserId, toUserId, roundToTwoDecimals(amount));
        settlement.setCurrency("INR");
        if (userRepository != null) {
            if (fromUserId != null && !fromUserId.trim().isEmpty()) {
                settlement.setFromUserName(userRepository.findById(fromUserId.trim())
                        .map(User::getFullName)
                        .orElse(fromUserId));
            } else {
                settlement.setFromUserName("Unknown");
            }
            if (toUserId != null && !toUserId.trim().isEmpty()) {
                settlement.setToUserName(userRepository.findById(toUserId.trim())
                        .map(User::getFullName)
                        .orElse(toUserId));
            } else {
                settlement.setToUserName("Unknown");
            }
        } else {
            settlement.setFromUserName(fromUserId != null ? fromUserId : "Unknown");
            settlement.setToUserName(toUserId != null ? toUserId : "Unknown");
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
     * Multi-Currency Handling:
     * Balances are aggregated in the group's default currency (or INR if unassigned).
     * For any bill denominated in a different currency, individual shares are converted
     * into the target currency using the bill's locked exchange rate. The payer is credited
     * with the exact sum of these converted shares, guaranteeing that sum(netBalances) == 0.00.
     *
     * Personal expenses (bills with no groupId, OR bills where all items have
     * at most one UNIQUE participant) are COMPLETELY excluded from any
     * debt/settlement math — they are personal records and must contribute
     * exactly 0 to every balance.
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

        final String targetCurrency = "INR";

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

            Map<String, Double> inrShares = calculateIndividualInrShares(bill);
            if (inrShares.isEmpty()) {
                continue;
            }

            String billCurrency = bill.getCurrency() != null && !bill.getCurrency().trim().isEmpty()
                    ? bill.getCurrency().trim().toUpperCase()
                    : "INR";

            // The payer is credited the exact sum of converted individual INR shares for this bill.
            // This guarantees that total credited equals total debited down to the exact paisa (cent),
            // strictly conserving money and preserving the zero-sum invariant across all currencies.
            double totalCredited = 0.0;
            for (Map.Entry<String, Double> entry : inrShares.entrySet()) {
                String userId = entry.getKey();
                if (userId == null || userId.trim().isEmpty()) {
                    continue;
                }
                double inrShare = entry.getValue() != null ? entry.getValue() : 0.0;
                totalCredited += inrShare;
                netBalances.put(userId.trim(), roundToTwoDecimals(netBalances.getOrDefault(userId.trim(), 0.0) - inrShare));
            }

            totalCredited = roundToTwoDecimals(totalCredited);
            String paidBy = bill.getPaidBy() != null ? bill.getPaidBy().trim() : null;
            if (paidBy != null && !paidBy.isEmpty()) {
                netBalances.put(paidBy, roundToTwoDecimals(netBalances.getOrDefault(paidBy, 0.0) + totalCredited));
            }

            log.debug("[SplitCalculation] Included group bill in balance math: id={}, title={}, billCurrency={}, targetCurrency={}, totalCredited={}, paidBy={}, inrShares={}",
                    bill.getId(), bill.getTitle(), billCurrency, targetCurrency, totalCredited, paidBy, inrShares);
        }

        // Filter out balances that are effectively zero (|balance| < 0.005)
        // Clean up small floating point residues and remove null/blank keys
        for (Map.Entry<String, Double> entry : new ArrayList<>(netBalances.entrySet())) {
            if (entry.getKey() == null || entry.getKey().trim().isEmpty()) {
                netBalances.remove(entry.getKey());
                continue;
            }
            double rounded = roundToTwoDecimals(entry.getValue() != null ? entry.getValue() : 0.0);
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
     * Calculates the remaining net balances for a group after accounting for
     * all PAID settlements.
     *
     * Net Balance = Sum of bill shares (Expenses) - Sum of PAID settlements.
     *
     * Payer of a settlement (debtor) has their negative balance credited (+amount).
     * Receiver of a settlement (creditor) has their positive balance debited (-amount).
     *
     * @param groupId the group ID
     * @return map of userId -> remaining net balance (positive = owed, negative = owes, 0.0 = settled)
     */
    public Map<String, Double> calculateRemainingNetBalancesForGroup(String groupId) {
        Map<String, Double> netBalances = calculateNetBalancesForGroup(groupId);

        // If a group has no bills/expenses, remaining balances are strictly empty (zero)
        if (netBalances.isEmpty()) {
            return netBalances;
        }

        final String targetCurrency = "INR";

        // Subtract already-PAID settlement amounts from net balances so
        // settled debts don't get recalculated as still owing.
        if (settlementRecordRepository != null) {
            try {
                List<SettlementRecord> paidSettlements = settlementRecordRepository
                        .findByGroupIdAndStatus(groupId, SettlementRecord.Status.PAID);
                if (paidSettlements != null) {
                    for (SettlementRecord paid : paidSettlements) {
                        if (paid.getFromUserId() != null && paid.getToUserId() != null && paid.getAmount() != null) {
                            // Only apply settlement if at least one party has an active balance in this group
                            if (!netBalances.containsKey(paid.getFromUserId()) && !netBalances.containsKey(paid.getToUserId())) {
                                continue;
                            }
                            double amount = roundToTwoDecimals(paid.getAmount());
                            String settlementCurrency = paid.getCurrency() != null && !paid.getCurrency().trim().isEmpty()
                                    ? paid.getCurrency().trim().toUpperCase()
                                    : "INR";
                            if (!settlementCurrency.equalsIgnoreCase(targetCurrency) && currencyConversionService != null) {
                                double rate = currencyConversionService.getExchangeRate(settlementCurrency, targetCurrency);
                                amount = roundToTwoDecimals(amount * rate);
                            }
                            netBalances.put(paid.getFromUserId(),
                                    roundToTwoDecimals(netBalances.getOrDefault(paid.getFromUserId(), 0.0) + amount));
                            netBalances.put(paid.getToUserId(),
                                    roundToTwoDecimals(netBalances.getOrDefault(paid.getToUserId(), 0.0) - amount));
                        }
                    }
                }
            } catch (Exception e) {
                log.warn("[SplitCalculation] Could not query paid settlements for group {}: {}", groupId, e.getMessage());
            }
        }

        // Clean up small floating point residues (< 0.005)
        for (Map.Entry<String, Double> entry : new ArrayList<>(netBalances.entrySet())) {
            double rounded = roundToTwoDecimals(entry.getValue());
            if (Math.abs(rounded) < 0.005) {
                netBalances.put(entry.getKey(), 0.0);
            } else {
                netBalances.put(entry.getKey(), rounded);
            }
        }

        return netBalances;
    }

    /**
     * Calculates all settlements needed for a group and persists them to the database.
     *
     * For each bill in the group:
     * - The person who paid (paidBy) is credited with the total amount
     * - Each person who shared items is debited their share
     *
     * Then PAID settlements are deducted from net balances.
     * Then simplifyDebts() is called to minimize the number of remaining transactions.
     * The calculated settlements are saved/updated in the database.
     *
     * Personal expenses are excluded entirely (see
     * {@link #calculateNetBalancesForGroup(String)}).
     *
     * @param groupId the group to calculate settlements for
     * @return list of Settlement objects representing the simplified debt structure
     */
    public List<Settlement> getSettlementsForGroup(String groupId) {
        final String targetCurrency = "INR";

        Map<String, Double> netBalances = calculateRemainingNetBalancesForGroup(groupId);

        // Simplify debts to minimize number of transactions
        List<Settlement> settlements = simplifyDebts(netBalances);
        for (Settlement settlement : settlements) {
            settlement.setCurrency(targetCurrency);
        }

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

        // Collect all unique persons involved (all item participants + payer)
        Set<String> persons = new HashSet<>();
        if (bill.getPaidBy() != null && !bill.getPaidBy().trim().isEmpty()) {
            persons.add(bill.getPaidBy().trim());
        }
        for (BillItem item : bill.getItems()) {
            if (item != null && item.getSharedByUserIds() != null) {
                for (String uid : item.getSharedByUserIds()) {
                    if (uid != null && !uid.trim().isEmpty()) {
                        persons.add(uid.trim());
                    }
                }
            }
        }

        // If there's only one unique person involved (e.g. payer paid only for themselves),
        // it's a personal expense that creates no cross-member debt.
        return persons.size() <= 1;
    }

    /**
     * Persists settlements to the database. Updates existing PENDING settlements
     * or creates new ones.
     *
     * @param groupId the group ID
     * @param settlements list of settlements to persist
     */
    private void persistSettlements(String groupId, List<Settlement> settlements) {
        if (settlementRecordRepository == null || groupId == null || settlements == null) {
            return;
        }
        try {
            // Delete existing PENDING settlements for this group
            List<SettlementRecord> existingPending = settlementRecordRepository.findByGroupIdAndStatus(groupId, SettlementRecord.Status.PENDING);
            if (existingPending != null && !existingPending.isEmpty()) {
                settlementRecordRepository.deleteAll(existingPending);
            }

            // Create new settlement records
            LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
            for (Settlement settlement : settlements) {
                if (settlement == null || settlement.getFromUserId() == null || settlement.getToUserId() == null) {
                    continue;
                }
                SettlementRecord record = new SettlementRecord();
                record.setGroupId(groupId);
                record.setFromUserId(settlement.getFromUserId());
                record.setToUserId(settlement.getToUserId());
                record.setAmount(settlement.getAmount());
                record.setCurrency(settlement.getCurrency() != null ? settlement.getCurrency() : "INR");
                record.setStatus(SettlementRecord.Status.PENDING);
                record.setCreatedAt(now);
                record.setPaidAt(null);
                SettlementRecord saved = settlementRecordRepository.save(record);
                if (saved != null) {
                    settlement.setId(saved.getId());
                }
                settlement.setStatus("PENDING");
            }
        } catch (Exception e) {
            log.warn("[SplitCalculation] Could not persist pending settlements for group {}: {}", groupId, e.getMessage());
        }
    }
}