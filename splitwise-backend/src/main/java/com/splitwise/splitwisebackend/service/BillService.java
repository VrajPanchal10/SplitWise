package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.dto.BillItemRequest;
import com.splitwise.splitwisebackend.dto.CreateBillRequest;
import com.splitwise.splitwisebackend.exception.ApiException;
import com.splitwise.splitwisebackend.model.Bill;
import com.splitwise.splitwisebackend.model.BillItem;
import com.splitwise.splitwisebackend.model.Group;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.BillRepository;
import com.splitwise.splitwisebackend.repository.GroupRepository;
import com.splitwise.splitwisebackend.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class BillService {

    private final BillRepository billRepository;
    private final GroupRepository groupRepository;
    private final UserRepository userRepository;
    private final ActivityService activityService;
    private final CurrencyConversionService currencyConversionService;

    public Bill createBill(CreateBillRequest request) {
        validateBillRequest(request);

        Bill bill = new Bill();
        bill.setTitle(request.getTitle().trim());
        bill.setGroupId(request.getGroupId());
        bill.setPaidBy(request.getPaidBy());
        bill.setCreatedAt(LocalDateTime.now(ZoneOffset.UTC));

        String currency = request.getCurrency() != null && !request.getCurrency().trim().isEmpty()
                ? currencyConversionService.validateAndNormalizeCurrency(request.getCurrency())
                : "INR";
        bill.setCurrency(currency);

        // Universal base settlement currency is strictly INR
        final String baseCurrency = "INR";
        bill.setBaseCurrency(baseCurrency);

        double rate;
        if ("INR".equalsIgnoreCase(currency)) {
            rate = 1.0;
        } else if (request.getExchangeRate() != null && request.getExchangeRate() > 0) {
            rate = request.getExchangeRate();
        } else {
            rate = currencyConversionService.getExchangeRate(currency, baseCurrency);
        }
        bill.setExchangeRate(rate);
        bill.setExchangeRateDate(LocalDateTime.now(ZoneOffset.UTC));

        List<BillItem> items = request.getItems().stream()
                .map(this::mapToBillItem)
                .collect(Collectors.toList());
        bill.setItems(items);
        bill.setReceiptUrl(request.getReceiptUrl());

        if (request.getTotalAmount() != null) {
            bill.setTotalAmount(Math.round(request.getTotalAmount() * 100.0) / 100.0);
        } else {
            double total = items.stream()
                    .mapToDouble(item -> item.getPrice() != null ? item.getPrice() : 0.0)
                    .sum();
            bill.setTotalAmount(Math.round(total * 100.0) / 100.0);
        }

        bill.setConvertedAmount(currencyConversionService.roundToTwoDecimals(bill.getTotalAmount() * rate));

        // Category
        String category = request.getCategory() != null && !request.getCategory().trim().isEmpty()
                ? request.getCategory().trim()
                : "Other";
        bill.setCategory(category);

        Bill saved = billRepository.save(bill);

        // Activity feed: notify the payer and every other participant
        logExpenseAddedActivities(saved);

        return saved;
    }

    /**
     * Logs EXPENSE_ADDED activities for a newly created bill:
     * - the payer sees "You added '[title]' (₹[amount])"
     * - every other participant sees "[PayerName] added '[title]' (₹[amount])"
     */
    private void logExpenseAddedActivities(Bill bill) {
        try {
            String payerId = bill.getPaidBy();
            String payerName = userRepository.findById(payerId)
                    .map(User::getFullName)
                    .orElse("Someone");

            // Collect all distinct participant user ids from the bill's items
            java.util.Set<String> participantIds = new java.util.LinkedHashSet<>();
            if (bill.getItems() != null) {
                for (BillItem item : bill.getItems()) {
                    if (item.getSharedByUserIds() != null) {
                        participantIds.addAll(item.getSharedByUserIds());
                    }
                }
            }

            String groupName = null;
            if (bill.getGroupId() != null) {
                groupName = groupRepository.findById(bill.getGroupId()).map(Group::getName).orElse(null);
            }

            String curr = bill.getCurrency() != null ? bill.getCurrency() : "INR";
            String symbol = currencyConversionService.getCurrencySymbol(curr);
            String amountFormatted = symbol + formatAmount(bill.getTotalAmount()) + " " + curr;
            if (bill.getBaseCurrency() != null && !bill.getBaseCurrency().equalsIgnoreCase(curr) && bill.getConvertedAmount() != null) {
                String baseSymbol = currencyConversionService.getCurrencySymbol(bill.getBaseCurrency());
                amountFormatted += " (≈ " + baseSymbol + formatAmount(bill.getConvertedAmount()) + " " + bill.getBaseCurrency() + ")";
            }

            // The payer always gets an entry
            String payerDescription = "You added '" + bill.getTitle() + "' (" + amountFormatted + ")";
            activityService.logActivity(
                    payerId,
                    "EXPENSE_ADDED",
                    payerDescription,
                    bill.getGroupId(),
                    bill.getId(),
                    payerId,
                    groupName,
                    bill.getTotalAmount());
            log.info("Activity logged: {}", payerDescription);

            // Every other participant gets an entry naming the payer
            for (String participantId : participantIds) {
                if (!participantId.equals(payerId)) {
                    String participantDescription = payerName + " added '" + bill.getTitle() + "' (" + amountFormatted + ")";
                    activityService.logActivity(
                            participantId,
                            "EXPENSE_ADDED",
                            participantDescription,
                            bill.getGroupId(),
                            bill.getId(),
                            payerId,
                            groupName,
                            bill.getTotalAmount());
                    log.info("Activity logged: {} (for user {})", participantDescription, participantId);
                }
            }
        } catch (Exception e) {
            // Never let activity logging break the main business flow
            org.slf4j.LoggerFactory.getLogger(BillService.class)
                    .error("Failed to log EXPENSE_ADDED activities for bill {}", bill.getId(), e);
        }
    }

    /** Formats an amount without trailing ".0" for whole numbers. */
    private String formatAmount(Double amount) {
        if (amount == null) {
            return "0";
        }
        if (amount == Math.floor(amount)) {
            return String.valueOf(amount.longValue());
        }
        return String.valueOf(amount);
    }

    private BillItem mapToBillItem(BillItemRequest request) {
        BillItem item = new BillItem();
        item.setName(request.getName() != null ? request.getName().trim() : "Item");
        item.setPrice(request.getPrice() != null ? Math.round(request.getPrice() * 100.0) / 100.0 : 0.0);
        // De-duplicate participant IDs while preserving stable order
        if (request.getSharedByUserIds() != null) {
            item.setSharedByUserIds(new java.util.ArrayList<>(new java.util.LinkedHashSet<>(request.getSharedByUserIds())));
        }
        item.setCustomShares(request.getCustomShares());
        return item;
    }

    private void validateBillRequest(CreateBillRequest request) {
        if (request == null) {
            throw new ApiException("Bill request cannot be null", HttpStatus.BAD_REQUEST);
        }
        if (request.getTitle() == null || request.getTitle().trim().isEmpty()) {
            throw new ApiException("Bill title is required", HttpStatus.BAD_REQUEST);
        }
        if (request.getPaidBy() == null || request.getPaidBy().trim().isEmpty()) {
            throw new ApiException("Payer ID is required", HttpStatus.BAD_REQUEST);
        }
        if (request.getTotalAmount() != null && request.getTotalAmount() <= 0) {
            throw new ApiException("Total amount must be greater than zero", HttpStatus.BAD_REQUEST);
        }
        if (request.getItems() == null || request.getItems().isEmpty()) {
            throw new ApiException("At least one bill item is required", HttpStatus.BAD_REQUEST);
        }

        String curr = request.getCurrency() != null && !request.getCurrency().trim().isEmpty()
                ? request.getCurrency().trim().toUpperCase()
                : "INR";
        currencyConversionService.validateCurrency(curr);
        String symbol = currencyConversionService.getCurrencySymbol(curr);

        java.util.Set<String> allParticipants = new java.util.HashSet<>();
        double itemsSum = 0.0;

        for (BillItemRequest item : request.getItems()) {
            if (item.getPrice() != null) {
                if (item.getPrice() < 0) {
                    throw new ApiException("Item price cannot be negative", HttpStatus.BAD_REQUEST);
                }
                itemsSum += item.getPrice();
            }

            List<String> sharedBy = item.getSharedByUserIds();
            if (sharedBy == null || sharedBy.isEmpty()) {
                throw new ApiException("Every item must have at least one participant", HttpStatus.BAD_REQUEST);
            }
            allParticipants.addAll(sharedBy);

            // Custom shares validation
            if (item.getCustomShares() != null && !item.getCustomShares().isEmpty()) {
                double customSum = 0.0;
                for (java.util.Map.Entry<String, Double> entry : item.getCustomShares().entrySet()) {
                    if (entry.getValue() == null || entry.getValue() < 0) {
                        throw new ApiException("Custom share amount cannot be negative", HttpStatus.BAD_REQUEST);
                    }
                    customSum += entry.getValue();
                }
                if (item.getPrice() != null && Math.abs(customSum - item.getPrice()) > 0.05) {
                    throw new ApiException("Custom shares for '" + item.getName() + "' (" + symbol +
                            String.format("%.2f", customSum) + ") must sum to item price (" + symbol +
                            String.format("%.2f", item.getPrice()) + ")", HttpStatus.BAD_REQUEST);
                }
            }
        }

        if (allParticipants.isEmpty()) {
            throw new ApiException("At least one participant must be selected", HttpStatus.BAD_REQUEST);
        }

        // Reconcile itemsSum with totalAmount if multiple items are provided
        if (request.getTotalAmount() != null && request.getItems().size() > 1) {
            if (Math.abs(itemsSum - request.getTotalAmount()) > 0.05) {
                throw new ApiException("Sum of item prices (" + symbol + String.format("%.2f", itemsSum) +
                        ") does not match bill total (" + symbol + String.format("%.2f", request.getTotalAmount()) + ")",
                        HttpStatus.BAD_REQUEST);
            }
        }
    }

    public Bill normalizeBill(Bill bill) {
        if (bill == null) return null;
        if (bill.getCurrency() == null || bill.getCurrency().trim().isEmpty()) {
            bill.setCurrency("INR");
        } else {
            bill.setCurrency(bill.getCurrency().trim().toUpperCase());
        }
        bill.setBaseCurrency("INR");
        if ("INR".equalsIgnoreCase(bill.getCurrency())) {
            if (bill.getExchangeRate() == null || bill.getExchangeRate() <= 0) {
                bill.setExchangeRate(1.0);
            }
            if (bill.getConvertedAmount() == null) {
                bill.setConvertedAmount(bill.getTotalAmount());
            }
        } else {
            if (bill.getExchangeRate() == null || bill.getExchangeRate() <= 0) {
                double rate = currencyConversionService.getExchangeRate(bill.getCurrency(), "INR");
                bill.setExchangeRate(rate);
            }
            if (bill.getConvertedAmount() == null || bill.getConvertedAmount() <= 0) {
                double total = bill.getTotalAmount() != null ? bill.getTotalAmount() : 0.0;
                bill.setConvertedAmount(currencyConversionService.roundToTwoDecimals(total * bill.getExchangeRate()));
            }
        }
        return bill;
    }

    public List<Bill> getBillsByGroup(String groupId) {
        List<Bill> bills = billRepository.findByGroupId(groupId);
        if (bills != null) {
            bills.forEach(this::normalizeBill);
            bills.sort((b1, b2) -> {
                LocalDateTime t1 = b1.getCreatedAt();
                LocalDateTime t2 = b2.getCreatedAt();
                if (t1 == null && t2 == null) return 0;
                if (t1 == null) return 1;
                if (t2 == null) return -1;
                return t2.compareTo(t1);
            });
        }
        return bills != null ? bills : Collections.emptyList();
    }

    public Bill getBillById(String billId) {
        Bill bill = billRepository.findById(billId)
                .orElseThrow(() -> new ApiException("Bill not found", HttpStatus.NOT_FOUND));
        return normalizeBill(bill);
    }

    public Bill updateBill(String billId, CreateBillRequest request) {
        validateBillRequest(request);
        Bill bill = getBillById(billId);

        if (request.getTitle() != null) {
            bill.setTitle(request.getTitle().trim());
        }
        if (request.getGroupId() != null) {
            bill.setGroupId(request.getGroupId());
        }
        if (request.getPaidBy() != null) {
            bill.setPaidBy(request.getPaidBy());
        }
        if (request.getItems() != null) {
            List<BillItem> items = request.getItems().stream()
                    .map(this::mapToBillItem)
                    .collect(Collectors.toList());
            bill.setItems(items);
        }
        if (request.getTotalAmount() != null) {
            bill.setTotalAmount(Math.round(request.getTotalAmount() * 100.0) / 100.0);
        } else if (request.getItems() != null) {
            double total = bill.getItems().stream()
                    .mapToDouble(item -> item.getPrice() != null ? item.getPrice() : 0.0)
                    .sum();
            bill.setTotalAmount(Math.round(total * 100.0) / 100.0);
        }

        if (request.getReceiptUrl() != null) {
            bill.setReceiptUrl(request.getReceiptUrl());
        }

        if (request.getCurrency() != null && !request.getCurrency().trim().isEmpty()) {
            String newCurrency = currencyConversionService.validateAndNormalizeCurrency(request.getCurrency());
            bill.setCurrency(newCurrency);
        }
        bill.setBaseCurrency("INR");

        if (request.getExchangeRate() != null && request.getExchangeRate() > 0) {
            bill.setExchangeRate(request.getExchangeRate());
            bill.setExchangeRateDate(LocalDateTime.now(ZoneOffset.UTC));
        } else if ("INR".equalsIgnoreCase(bill.getCurrency())) {
            bill.setExchangeRate(1.0);
            bill.setExchangeRateDate(LocalDateTime.now(ZoneOffset.UTC));
        } else if (bill.getExchangeRate() == null || bill.getExchangeRate() <= 0) {
            bill.setExchangeRate(currencyConversionService.getExchangeRate(bill.getCurrency(), "INR"));
            bill.setExchangeRateDate(LocalDateTime.now(ZoneOffset.UTC));
        }

        // Category
        if (request.getCategory() != null && !request.getCategory().trim().isEmpty()) {
            bill.setCategory(request.getCategory().trim());
        }

        double rate = bill.getExchangeRate() != null && bill.getExchangeRate() > 0 ? bill.getExchangeRate() : 1.0;
        bill.setConvertedAmount(currencyConversionService.roundToTwoDecimals(bill.getTotalAmount() * rate));

        return billRepository.save(bill);
    }

    public void deleteBill(String billId) {
        Bill bill = getBillById(billId);
        billRepository.delete(bill);
    }

    public List<Bill> getAllBillsForUser(String userId) {
        // Get bills where user is the payer
        List<Bill> paidBills = billRepository.findByPaidBy(userId);
        
        // Get bills where user is a participant (through BillItems)
        List<Bill> participantBills = billRepository.findByItemsSharedByUserIdsContaining(userId);
        
        // Combine and remove duplicates
        List<Bill> allBills = new java.util.ArrayList<>(paidBills);
        for (Bill bill : participantBills) {
            if (!allBills.contains(bill)) {
                allBills.add(bill);
            }
        }
        allBills.forEach(this::normalizeBill);
        
        // Sort by date (most recent first, null-safe)
        allBills.sort((b1, b2) -> {
            LocalDateTime t1 = b1.getCreatedAt();
            LocalDateTime t2 = b2.getCreatedAt();
            if (t1 == null && t2 == null) return 0;
            if (t1 == null) return 1;
            if (t2 == null) return -1;
            return t2.compareTo(t1);
        });
        
        return allBills;
    }

    public List<Bill> getBillsWithFriend(String userId, String friendId) {
        // Get all bills where the current user is a participant
        List<Bill> userBills = getAllBillsForUser(userId);

        // Filter to only bills where the friend is also a participant
        List<Bill> billsWithFriend = userBills.stream()
                .filter(bill -> isFriendParticipant(bill, friendId))
                .collect(Collectors.toList());

        // Sort by createdAt descending (null-safe)
        billsWithFriend.sort((b1, b2) -> {
            LocalDateTime t1 = b1.getCreatedAt();
            LocalDateTime t2 = b2.getCreatedAt();
            if (t1 == null && t2 == null) return 0;
            if (t1 == null) return 1;
            if (t2 == null) return -1;
            return t2.compareTo(t1);
        });

        return billsWithFriend;
    }

    private boolean isFriendParticipant(Bill bill, String friendId) {
        // Check if friend is the payer
        if (friendId.equals(bill.getPaidBy())) {
            return true;
        }

        // Check if friend is in any item's sharedByUserIds
        if (bill.getItems() != null) {
            for (BillItem item : bill.getItems()) {
                if (item.getSharedByUserIds() != null && item.getSharedByUserIds().contains(friendId)) {
                    return true;
                }
            }
        }

        // If it's a group bill, check if friend is in the group's memberIds
        if (bill.getGroupId() != null) {
            Group group = groupRepository.findById(bill.getGroupId()).orElse(null);
            if (group != null && group.getMemberIds() != null && group.getMemberIds().contains(friendId)) {
                return true;
            }
        }

        return false;
    }
}
