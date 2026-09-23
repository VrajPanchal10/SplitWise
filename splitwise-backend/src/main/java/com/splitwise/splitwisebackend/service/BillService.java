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

    public Bill createBill(CreateBillRequest request) {
        Bill bill = new Bill();
        bill.setTitle(request.getTitle());
        bill.setGroupId(request.getGroupId());
        bill.setPaidBy(request.getPaidBy());
        bill.setCreatedAt(LocalDateTime.now());

        List<BillItem> items = request.getItems().stream()
                .map(this::mapToBillItem)
                .collect(Collectors.toList());
        bill.setItems(items);

        if (request.getTotalAmount() != null) {
            bill.setTotalAmount(request.getTotalAmount());
        } else {
            double total = items.stream()
                    .mapToDouble(item -> item.getPrice() != null ? item.getPrice() : 0.0)
                    .sum();
            bill.setTotalAmount(total);
        }

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

            // The payer always gets an entry
            String payerDescription = "You added '" + bill.getTitle() + "' (₹" + formatAmount(bill.getTotalAmount()) + ")";
            activityService.logActivity(
                    payerId,
                    "EXPENSE_ADDED",
                    payerDescription,
                    bill.getGroupId(),
                    bill.getId(),
                    payerId);
            log.info("Activity logged: {}", payerDescription);

            // Every other participant gets an entry naming the payer
            for (String participantId : participantIds) {
                if (!participantId.equals(payerId)) {
                    String participantDescription = payerName + " added '" + bill.getTitle() + "' (₹" + formatAmount(bill.getTotalAmount()) + ")";
                    activityService.logActivity(
                            participantId,
                            "EXPENSE_ADDED",
                            participantDescription,
                            bill.getGroupId(),
                            bill.getId(),
                            payerId);
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
        item.setName(request.getName());
        item.setPrice(request.getPrice());
        item.setSharedByUserIds(request.getSharedByUserIds());
        return item;
    }

    public List<Bill> getBillsByGroup(String groupId) {
        List<Bill> bills = billRepository.findByGroupId(groupId);
        bills.sort((b1, b2) -> b2.getCreatedAt().compareTo(b1.getCreatedAt()));
        return bills;
    }

    public Bill getBillById(String billId) {
        return billRepository.findById(billId)
                .orElseThrow(() -> new ApiException("Bill not found", HttpStatus.NOT_FOUND));
    }

    public Bill updateBill(String billId, CreateBillRequest request) {
        Bill bill = getBillById(billId);

        if (request.getTitle() != null) {
            bill.setTitle(request.getTitle());
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
            bill.setTotalAmount(request.getTotalAmount());
        } else if (request.getItems() != null) {
            double total = bill.getItems().stream()
                    .mapToDouble(item -> item.getPrice() != null ? item.getPrice() : 0.0)
                    .sum();
            bill.setTotalAmount(total);
        }

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
        
        // Sort by date (most recent first)
        allBills.sort((b1, b2) -> b2.getCreatedAt().compareTo(b1.getCreatedAt()));
        
        return allBills;
    }

    public List<Bill> getBillsWithFriend(String userId, String friendId) {
        // Get all bills where the current user is a participant
        List<Bill> userBills = getAllBillsForUser(userId);

        // Filter to only bills where the friend is also a participant
        List<Bill> billsWithFriend = userBills.stream()
                .filter(bill -> isFriendParticipant(bill, friendId))
                .collect(Collectors.toList());

        // Sort by createdAt descending
        billsWithFriend.sort((b1, b2) -> b2.getCreatedAt().compareTo(b1.getCreatedAt()));

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
