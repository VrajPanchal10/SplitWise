package com.splitwise.splitwisebackend.controller;

import com.splitwise.splitwisebackend.exception.ApiException;
import com.splitwise.splitwisebackend.model.FriendBalance;
import com.splitwise.splitwisebackend.model.SettlementRecord;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.FriendBalanceRepository;
import com.splitwise.splitwisebackend.repository.SettlementRecordRepository;
import com.splitwise.splitwisebackend.repository.UserRepository;
import com.splitwise.splitwisebackend.service.ActivityService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;

@RestController
@RequestMapping("/api/settlements")
@RequiredArgsConstructor
public class SettlementController {

    private final SettlementRecordRepository settlementRecordRepository;
    private final FriendBalanceRepository friendBalanceRepository;
    private final UserRepository userRepository;
    private final ActivityService activityService;

    private String getCurrentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        String email = authentication.getName();
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new ApiException("User not found", HttpStatus.NOT_FOUND));
        return user.getId();
    }

    @PutMapping("/{id}/mark-paid")
    public ResponseEntity<SettlementRecord> markSettlementAsPaid(@PathVariable String id) {
        SettlementRecord settlement = settlementRecordRepository.findById(id)
                .orElseThrow(() -> new ApiException("Settlement not found", HttpStatus.NOT_FOUND));

        if (settlement.getStatus() == SettlementRecord.Status.PAID) {
            throw new ApiException("Settlement is already marked as paid", HttpStatus.BAD_REQUEST);
        }

        settlement.setStatus(SettlementRecord.Status.PAID);
        settlement.setPaidAt(LocalDateTime.now());
        SettlementRecord updated = settlementRecordRepository.save(settlement);

        return ResponseEntity.ok(updated);
    }

    /**
     * Marks all PENDING settlements between the current user and the given
     * friend as PAID, and zeroes out the FriendBalance record between them.
     *
     * If no settlement records exist (e.g. balances are computed dynamically
     * from bills), it still zeroes out the FriendBalance so the frontend
     * shows "settled up". This should never fail — settling up with a friend
     * is always valid.
     *
     * @param friendId the friend's user ID
     * @return the list of updated settlement records (may be empty)
     */
    @PostMapping("/settle-with-friend/{friendId}")
    public ResponseEntity<List<SettlementRecord>> settleWithFriend(@PathVariable String friendId) {
        String currentUserId = getCurrentUserId();

        // 1. Mark all PENDING settlements between the two users as PAID (in either direction)
        List<SettlementRecord> pendingSettlements = settlementRecordRepository
                .findSettlementsBetweenUsersAndStatus(currentUserId, friendId, SettlementRecord.Status.PENDING);

        LocalDateTime now = LocalDateTime.now();
        for (SettlementRecord settlement : pendingSettlements) {
            settlement.setStatus(SettlementRecord.Status.PAID);
            settlement.setPaidAt(now);
        }
        if (!pendingSettlements.isEmpty()) {
            settlementRecordRepository.saveAll(pendingSettlements);
        }

        // 2. Create/zero the explicit FriendBalance record so that
        //    UserService.getAllFriendBalances can detect it and keep the
        //    balance "settled up". This takes precedence over dynamic
        //    computation, so new bills in new groups will still show correctly
        //    because the dynamic balance will grow again.
        List<FriendBalance> balanceFromMeList = friendBalanceRepository
                .findByUserIdAndFriendId(currentUserId, friendId);
        if (balanceFromMeList.isEmpty()) {
            FriendBalance newBalance = new FriendBalance();
            newBalance.setUserId(currentUserId);
            newBalance.setFriendId(friendId);
            newBalance.setNetBalance(0.0);
            newBalance.setCreatedAt(now);
            friendBalanceRepository.save(newBalance);
        } else {
            for (FriendBalance fb : balanceFromMeList) {
                fb.setNetBalance(0.0);
                friendBalanceRepository.save(fb);
            }
        }

        List<FriendBalance> balanceToMeList = friendBalanceRepository
                .findByUserIdAndFriendId(friendId, currentUserId);
        if (balanceToMeList.isEmpty()) {
            FriendBalance newBalance = new FriendBalance();
            newBalance.setUserId(friendId);
            newBalance.setFriendId(currentUserId);
            newBalance.setNetBalance(0.0);
            newBalance.setCreatedAt(now);
            friendBalanceRepository.save(newBalance);
        } else {
            for (FriendBalance fb : balanceToMeList) {
                fb.setNetBalance(0.0);
                friendBalanceRepository.save(fb);
            }
        }

        // 3. Always create PAID settlement records so that UserService.getAllFriendBalances
        //    can subtract the settled amounts from the dynamic bill-based balances.
        //    This ensures the balance shows "settled up" after settling, and if new bills
        //    are added later, the balance correctly grows again.
        //    We create records for both directions with the actual amounts.
        
        // First, get the current dynamic balances to know what amounts were settled
        double amountOwed = 0.0;
        List<FriendBalance> explicitBalances = friendBalanceRepository.findByUserId(currentUserId);
        for (FriendBalance fb : explicitBalances) {
            if (fb.getFriendId().equals(friendId)) {
                amountOwed = Math.abs(fb.getNetBalance());
                break;
            }
        }

        // Create PAID settlement: current user paid friend for the owed amount
        SettlementRecord paidByMe = new SettlementRecord();
        paidByMe.setGroupId(null);
        paidByMe.setFromUserId(currentUserId);
        paidByMe.setToUserId(friendId);
        paidByMe.setAmount(amountOwed);
        paidByMe.setStatus(SettlementRecord.Status.PAID);
        paidByMe.setCreatedAt(now);
        paidByMe.setPaidAt(now);
        settlementRecordRepository.save(paidByMe);

        // Create PAID settlement: friend paid current user for the owed amount
        SettlementRecord paidByFriend = new SettlementRecord();
        paidByFriend.setGroupId(null);
        paidByFriend.setFromUserId(friendId);
        paidByFriend.setToUserId(currentUserId);
        paidByFriend.setAmount(amountOwed);
        paidByFriend.setStatus(SettlementRecord.Status.PAID);
        paidByFriend.setCreatedAt(now);
        paidByFriend.setPaidAt(now);
        settlementRecordRepository.save(paidByFriend);

        // 4. Activity feed: notify both parties about the settlement
        String friendName = userRepository.findById(friendId)
                .map(User::getFullName)
                .orElse("your friend");
        String currentUserName = userRepository.findById(currentUserId)
                .map(User::getFullName)
                .orElse("Someone");
        String amountStr = formatAmount(amountOwed);

        // The current user (who initiated the settle-up)
        activityService.logActivity(
                currentUserId,
                "EXPENSE_SETTLED",
                "You settled ₹" + amountStr + " with " + friendName,
                null,
                null,
                currentUserId);

        // The friend sees who settled with them
        activityService.logActivity(
                friendId,
                "EXPENSE_SETTLED",
                currentUserName + " settled ₹" + amountStr + " with you",
                null,
                null,
                currentUserId);

        // 5. No need for additional FriendBalance creation here — the explicit
        //    zero-balance records created in step 2 will take precedence in
        //    UserService.getAllFriendBalances, showing "settled up". If new bills
        //    are added later, the dynamic balance will grow again.

        return ResponseEntity.ok(Collections.emptyList());
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
