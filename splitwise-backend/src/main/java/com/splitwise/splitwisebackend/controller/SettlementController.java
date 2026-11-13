package com.splitwise.splitwisebackend.controller;

import com.splitwise.splitwisebackend.dto.RecordSettlementRequest;
import com.splitwise.splitwisebackend.exception.ApiException;
import com.splitwise.splitwisebackend.model.FriendBalance;
import com.splitwise.splitwisebackend.model.Group;
import com.splitwise.splitwisebackend.model.SettlementRecord;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.FriendBalanceRepository;
import com.splitwise.splitwisebackend.repository.GroupRepository;
import com.splitwise.splitwisebackend.repository.SettlementRecordRepository;
import com.splitwise.splitwisebackend.repository.UserRepository;
import com.splitwise.splitwisebackend.service.ActivityService;
import com.splitwise.splitwisebackend.service.CurrencyConversionService;
import com.splitwise.splitwisebackend.service.SplitCalculationService;
import com.splitwise.splitwisebackend.service.UserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@RestController
@RequestMapping("/api/settlements")
@RequiredArgsConstructor
public class SettlementController {

    private final SettlementRecordRepository settlementRecordRepository;
    private final FriendBalanceRepository friendBalanceRepository;
    private final UserRepository userRepository;
    private final GroupRepository groupRepository;
    private final ActivityService activityService;
    private final UserService userService;
    private final SplitCalculationService splitCalculationService;
    private final CurrencyConversionService currencyConversionService;

    private String getCurrentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        String email = authentication.getName();
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new ApiException("User not found", HttpStatus.NOT_FOUND));
        return user.getId();
    }

    /**
     * Records a persistent settlement between two users (either in a group or direct).
     * Saved with status PAID in MongoDB, immediately re-calculating remaining group balances.
     */
    @PostMapping
    public ResponseEntity<SettlementRecord> recordSettlement(@Valid @RequestBody RecordSettlementRequest request) {
        String currentUserId = getCurrentUserId();

        String fromUserId = request.getFromUserId() != null ? request.getFromUserId().trim() : null;
        String toUserId = request.getToUserId() != null ? request.getToUserId().trim() : null;

        if (fromUserId == null || toUserId == null) {
            throw new ApiException("Both payer (fromUserId) and recipient (toUserId) are required", HttpStatus.BAD_REQUEST);
        }

        if (fromUserId.equalsIgnoreCase(toUserId)) {
            throw new ApiException("Cannot settle with yourself", HttpStatus.BAD_REQUEST);
        }

        if (request.getAmount() == null || request.getAmount() <= 0.005) {
            throw new ApiException("Settlement amount must be greater than zero", HttpStatus.BAD_REQUEST);
        }

        // Verify users exist
        User fromUser = userRepository.findById(fromUserId)
                .orElseThrow(() -> new ApiException("Payer user not found: " + fromUserId, HttpStatus.NOT_FOUND));
        User toUser = userRepository.findById(toUserId)
                .orElseThrow(() -> new ApiException("Recipient user not found: " + toUserId, HttpStatus.NOT_FOUND));

        String groupId = request.getGroupId() != null && !request.getGroupId().trim().isEmpty() ? request.getGroupId().trim() : null;
        if (groupId != null) {
            Group group = groupRepository.findById(groupId)
                    .orElseThrow(() -> new ApiException("Group not found: " + groupId, HttpStatus.NOT_FOUND));
            if (group.getMemberIds() == null || !group.getMemberIds().contains(fromUserId) || !group.getMemberIds().contains(toUserId)) {
                throw new ApiException("Both payer and recipient must be members of the group", HttpStatus.BAD_REQUEST);
            }
        }

        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        double roundedAmount = roundToTwoDecimals(request.getAmount());

        // Settlement currency is universally INR
        String requestedCurrency = request.getCurrency() != null && !request.getCurrency().trim().isEmpty()
                ? request.getCurrency().trim().toUpperCase()
                : "INR";
        if (!"INR".equalsIgnoreCase(requestedCurrency) && currencyConversionService != null) {
            double rate = currencyConversionService.getExchangeRate(requestedCurrency, "INR");
            roundedAmount = roundToTwoDecimals(roundedAmount * rate);
        }
        final String settlementCurrency = "INR";

        // Idempotency / Duplicate protection: Check if identical settlement was recorded in last 5 seconds
        LocalDateTime fiveSecondsAgo = now.minusSeconds(5);
        List<SettlementRecord> existingRecords = groupId != null
                ? settlementRecordRepository.findByGroupIdAndStatus(groupId, SettlementRecord.Status.PAID)
                : settlementRecordRepository.findSettlementsBetweenUsersAndStatus(fromUserId, toUserId, SettlementRecord.Status.PAID);
        if (existingRecords != null) {
            for (SettlementRecord r : existingRecords) {
                if (fromUserId.equals(r.getFromUserId())
                        && toUserId.equals(r.getToUserId())
                        && Math.abs(r.getAmount() - roundedAmount) < 0.005
                        && r.getCreatedAt() != null
                        && r.getCreatedAt().isAfter(fiveSecondsAgo)) {
                    return ResponseEntity.status(HttpStatus.OK).body(r);
                }
            }
        }

        SettlementRecord record = new SettlementRecord();
        record.setGroupId(groupId);
        record.setFromUserId(fromUserId);
        record.setToUserId(toUserId);
        record.setAmount(roundedAmount);
        record.setCurrency(settlementCurrency);
        record.setStatus(SettlementRecord.Status.PAID);
        record.setCreatedAt(now);
        record.setPaidAt(now);

        SettlementRecord saved = settlementRecordRepository.save(record);

        // Re-synchronize group balances and pending debts immediately if group settlement
        if (groupId != null) {
            splitCalculationService.getSettlementsForGroup(groupId);
        }

        // Direct 1-on-1 settlement (outside groups): zero out explicit friend balances between the two users
        if (groupId == null) {
            List<FriendBalance> fromMeList = friendBalanceRepository.findByUserIdAndFriendId(fromUserId, toUserId);
            for (FriendBalance fb : fromMeList) {
                fb.setNetBalance(0.0);
                friendBalanceRepository.save(fb);
            }
            List<FriendBalance> toMeList = friendBalanceRepository.findByUserIdAndFriendId(toUserId, fromUserId);
            for (FriendBalance fb : toMeList) {
                fb.setNetBalance(0.0);
                friendBalanceRepository.save(fb);
            }
        }

        // Activity feed notification
        String amountStr = formatAmount(roundedAmount);
        String symbol = "INR".equalsIgnoreCase(settlementCurrency) ? "₹" : settlementCurrency + " ";
        String grpName = null;
        if (groupId != null) {
            Group grp = groupRepository.findById(groupId).orElse(null);
            if (grp != null) {
                grpName = grp.getName();
                if (grp.getMemberIds() != null) {
                    for (String memberId : grp.getMemberIds()) {
                        String desc;
                        if (memberId.equals(fromUserId)) {
                            desc = "You paid " + symbol + amountStr + " to " + toUser.getFullName();
                        } else if (memberId.equals(toUserId)) {
                            desc = fromUser.getFullName() + " paid you " + symbol + amountStr;
                        } else {
                            desc = fromUser.getFullName() + " paid " + toUser.getFullName() + " " + symbol + amountStr;
                        }
                        activityService.logActivity(
                                memberId,
                                "EXPENSE_SETTLED",
                                desc,
                                groupId,
                                null,
                                currentUserId,
                                grpName,
                                roundedAmount);
                    }
                }
            }
        }
        if (groupId == null) {
            activityService.logActivity(
                    fromUserId,
                    "EXPENSE_SETTLED",
                    "You paid " + symbol + amountStr + " to " + toUser.getFullName(),
                    null,
                    null,
                    currentUserId,
                    null,
                    roundedAmount);
            activityService.logActivity(
                    toUserId,
                    "EXPENSE_SETTLED",
                    fromUser.getFullName() + " paid you " + symbol + amountStr,
                    null,
                    null,
                    currentUserId,
                    null,
                    roundedAmount);
        }

        return ResponseEntity.status(HttpStatus.CREATED).body(saved);
    }

    /**
     * Retrieves all persistent PAID settlements recorded for a group, sorted newest first.
     */
    @GetMapping("/group/{groupId}")
    public ResponseEntity<List<SettlementRecord>> getPaidSettlementsForGroup(@PathVariable("groupId") String groupId) {
        List<SettlementRecord> paid = settlementRecordRepository.findByGroupIdAndStatus(groupId, SettlementRecord.Status.PAID);
        if (paid != null) {
            paid.sort((a, b) -> {
                LocalDateTime timeA = a.getPaidAt() != null ? a.getPaidAt() : a.getCreatedAt();
                LocalDateTime timeB = b.getPaidAt() != null ? b.getPaidAt() : b.getCreatedAt();
                if (timeA == null && timeB == null) return 0;
                if (timeA == null) return 1;
                if (timeB == null) return -1;
                return timeB.compareTo(timeA);
            });
        }
        return ResponseEntity.ok(paid != null ? paid : Collections.emptyList());
    }

    /**
     * Retrieves all persistent PAID settlements recorded between the current user and a friend.
     * Ordered by paidAt / createdAt descending (newest first).
     */
    @GetMapping("/friend/{friendId}")
    public ResponseEntity<List<SettlementRecord>> getPaidSettlementsWithFriend(@PathVariable("friendId") String friendId) {
        String currentUserId = getCurrentUserId();
        List<SettlementRecord> paid = settlementRecordRepository.findSettlementsBetweenUsersAndStatus(
                currentUserId, friendId, SettlementRecord.Status.PAID);
        if (paid != null) {
            paid.sort((a, b) -> {
                LocalDateTime timeA = a.getPaidAt() != null ? a.getPaidAt() : a.getCreatedAt();
                LocalDateTime timeB = b.getPaidAt() != null ? b.getPaidAt() : b.getCreatedAt();
                if (timeA == null && timeB == null) return 0;
                if (timeA == null) return 1;
                if (timeB == null) return -1;
                return timeB.compareTo(timeA);
            });
        }
        return ResponseEntity.ok(paid != null ? paid : Collections.emptyList());
    }

    @PutMapping("/{id}/mark-paid")
    public ResponseEntity<SettlementRecord> markSettlementAsPaid(@PathVariable("id") String id) {
        SettlementRecord settlement = settlementRecordRepository.findById(id)
                .orElseThrow(() -> new ApiException("Settlement not found", HttpStatus.NOT_FOUND));

        if (settlement.getStatus() == SettlementRecord.Status.PAID) {
            throw new ApiException("Settlement is already marked as paid", HttpStatus.BAD_REQUEST);
        }

        settlement.setStatus(SettlementRecord.Status.PAID);
        settlement.setPaidAt(LocalDateTime.now(ZoneOffset.UTC));
        SettlementRecord updated = settlementRecordRepository.save(settlement);

        if (updated.getGroupId() != null) {
            splitCalculationService.getSettlementsForGroup(updated.getGroupId());
        }

        String currentUserId = getCurrentUserId();
        String fromName = userRepository.findById(updated.getFromUserId()).map(User::getFullName).orElse("Someone");
        String toName = userRepository.findById(updated.getToUserId()).map(User::getFullName).orElse("Someone");
        String amountStr = formatAmount(updated.getAmount());

        String grpName = null;
        if (updated.getGroupId() != null) {
            Group grp = groupRepository.findById(updated.getGroupId()).orElse(null);
            if (grp != null) {
                grpName = grp.getName();
                if (grp.getMemberIds() != null) {
                    for (String memberId : grp.getMemberIds()) {
                        String desc;
                        if (memberId.equals(updated.getFromUserId())) {
                            desc = "You paid ₹" + amountStr + " to " + toName;
                        } else if (memberId.equals(updated.getToUserId())) {
                            desc = fromName + " paid you ₹" + amountStr;
                        } else {
                            desc = fromName + " paid " + toName + " ₹" + amountStr;
                        }
                        activityService.logActivity(
                                memberId,
                                "EXPENSE_SETTLED",
                                desc,
                                updated.getGroupId(),
                                null,
                                currentUserId,
                                grpName,
                                updated.getAmount());
                    }
                }
            }
        }
        if (updated.getGroupId() == null) {
            activityService.logActivity(
                    updated.getFromUserId(),
                    "EXPENSE_SETTLED",
                    "You settled ₹" + amountStr + " with " + toName,
                    null,
                    null,
                    currentUserId,
                    null,
                    updated.getAmount());
            activityService.logActivity(
                    updated.getToUserId(),
                    "EXPENSE_SETTLED",
                    fromName + " settled ₹" + amountStr + " with you",
                    null,
                    null,
                    currentUserId,
                    null,
                    updated.getAmount());
        }

        return ResponseEntity.ok(updated);
    }

    /**
     * Settles all outstanding debts between the current user and the specified friend.
     * Accurately updates group-level simplified settlements to PAID, updates direct 1-on-1 balances,
     * resets FriendBalance records, and logs activity.
     */
    @PostMapping("/settle-with-friend/{friendId}")
    public ResponseEntity<List<SettlementRecord>> settleWithFriend(@PathVariable("friendId") String friendId) {
        String currentUserId = getCurrentUserId();
        if (friendId == null || friendId.trim().equalsIgnoreCase(currentUserId.trim())) {
            throw new ApiException("Cannot settle with yourself", HttpStatus.BAD_REQUEST);
        }

        // 1. Determine current balance between the two users
        List<FriendBalance> currentBalances = userService.getAllFriendBalances(currentUserId);
        double netBalance = 0.0;
        for (FriendBalance fb : currentBalances) {
            if (fb.getFriendId() != null && fb.getFriendId().equals(friendId)) {
                netBalance = fb.getNetBalance() != null ? fb.getNetBalance() : 0.0;
                break;
            }
        }
        double amountOwed = Math.abs(netBalance);
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        List<SettlementRecord> savedRecords = new ArrayList<>();

        // 2. For each shared group between currentUserId and friendId:
        //    Ensure settlements are generated and mark any PENDING settlement between them as PAID
        List<Group> userGroups = groupRepository.findByMemberIdsContaining(currentUserId);
        for (Group group : userGroups) {
            if (group.getId() != null && group.getMemberIds() != null && group.getMemberIds().contains(friendId)) {
                // Ensure latest settlements are persisted as PENDING
                splitCalculationService.getSettlementsForGroup(group.getId());

                List<SettlementRecord> groupPending = settlementRecordRepository
                        .findSettlementsBetweenUsersAndStatus(currentUserId, friendId, SettlementRecord.Status.PENDING);
                for (SettlementRecord s : groupPending) {
                    if (group.getId().equals(s.getGroupId())) {
                        s.setStatus(SettlementRecord.Status.PAID);
                        s.setPaidAt(now);
                        savedRecords.add(settlementRecordRepository.save(s));
                    }
                }
                // Immediately re-sync group settlements after marking PAID
                splitCalculationService.getSettlementsForGroup(group.getId());
            }
        }

        // 3. Mark any remaining PENDING settlements between the two users as PAID
        List<SettlementRecord> allPending = settlementRecordRepository
                .findSettlementsBetweenUsersAndStatus(currentUserId, friendId, SettlementRecord.Status.PENDING);
        for (SettlementRecord s : allPending) {
            s.setStatus(SettlementRecord.Status.PAID);
            s.setPaidAt(now);
            savedRecords.add(settlementRecordRepository.save(s));
            if (s.getGroupId() != null) {
                splitCalculationService.getSettlementsForGroup(s.getGroupId());
            }
        }

        // 4. If there were no group settlements marked PAID, but there was an active balance,
        //    create a PAID SettlementRecord to track this settlement.
        if (savedRecords.isEmpty() && amountOwed >= 0.005) {
            String fromUser = netBalance < 0 ? currentUserId : friendId;
            String toUser = netBalance < 0 ? friendId : currentUserId;

            // Direct 1-on-1 settlement between friends: groupId is null so it never pollutes unrelated groups
            SettlementRecord directPaid = new SettlementRecord();
            directPaid.setGroupId(null);
            directPaid.setFromUserId(fromUser);
            directPaid.setToUserId(toUser);
            directPaid.setAmount(roundToTwoDecimals(amountOwed));
            directPaid.setStatus(SettlementRecord.Status.PAID);
            directPaid.setCreatedAt(now);
            directPaid.setPaidAt(now);
            SettlementRecord saved = settlementRecordRepository.save(directPaid);
            savedRecords.add(saved);
        }

        // 5. Zero out any explicit FriendBalance records
        List<FriendBalance> balanceFromMeList = friendBalanceRepository
                .findByUserIdAndFriendId(currentUserId, friendId);
        for (FriendBalance fb : balanceFromMeList) {
            fb.setNetBalance(0.0);
            friendBalanceRepository.save(fb);
        }
        List<FriendBalance> balanceToMeList = friendBalanceRepository
                .findByUserIdAndFriendId(friendId, currentUserId);
        for (FriendBalance fb : balanceToMeList) {
            fb.setNetBalance(0.0);
            friendBalanceRepository.save(fb);
        }

        // 6. Activity feed: notify both parties about the settlement
        String friendName = userRepository.findById(friendId)
                .map(User::getFullName)
                .orElse("your friend");
        String currentUserName = userRepository.findById(currentUserId)
                .map(User::getFullName)
                .orElse("Someone");
        String amountStr = formatAmount(amountOwed);

        // Find shared group if any for contextual activity display
        String sharedGroupId = null;
        for (Group group : userGroups) {
            if (group.getId() != null && group.getMemberIds() != null && group.getMemberIds().contains(friendId)) {
                sharedGroupId = group.getId();
                break;
            }
        }
        String sharedGroupName = null;
        if (sharedGroupId != null) {
            sharedGroupName = groupRepository.findById(sharedGroupId).map(Group::getName).orElse(null);
        }

        if (netBalance < -0.005) {
            // Current user paid friend
            activityService.logActivity(
                    currentUserId,
                    "EXPENSE_SETTLED",
                    "You settled ₹" + amountStr + " with " + friendName,
                    sharedGroupId,
                    null,
                    currentUserId,
                    sharedGroupName,
                    amountOwed);
            activityService.logActivity(
                    friendId,
                    "EXPENSE_SETTLED",
                    currentUserName + " settled ₹" + amountStr + " with you",
                    sharedGroupId,
                    null,
                    currentUserId,
                    sharedGroupName,
                    amountOwed);
        } else {
            // Friend paid current user (or settled)
            activityService.logActivity(
                    currentUserId,
                    "EXPENSE_SETTLED",
                    friendName + " settled ₹" + amountStr + " with you",
                    sharedGroupId,
                    null,
                    currentUserId,
                    sharedGroupName,
                    amountOwed);
            activityService.logActivity(
                    friendId,
                    "EXPENSE_SETTLED",
                    "You settled ₹" + amountStr + " with " + currentUserName,
                    sharedGroupId,
                    null,
                    currentUserId,
                    sharedGroupName,
                    amountOwed);
        }

        return ResponseEntity.ok(savedRecords);
    }

    private static double roundToTwoDecimals(double value) {
        return Math.round(value * 100.0) / 100.0;
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
}
