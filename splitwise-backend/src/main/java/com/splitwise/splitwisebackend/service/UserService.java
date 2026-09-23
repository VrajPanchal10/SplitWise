package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.dto.UserStats;
import com.splitwise.splitwisebackend.exception.ApiException;
import com.splitwise.splitwisebackend.model.Bill;
import com.splitwise.splitwisebackend.model.BillItem;
import com.splitwise.splitwisebackend.model.FriendBalance;
import com.splitwise.splitwisebackend.model.Group;
import com.splitwise.splitwisebackend.model.SettlementRecord;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.BillRepository;
import com.splitwise.splitwisebackend.repository.FriendBalanceRepository;
import com.splitwise.splitwisebackend.repository.GroupRepository;
import com.splitwise.splitwisebackend.repository.SettlementRecordRepository;
import com.splitwise.splitwisebackend.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final BillRepository billRepository;
    private final FriendBalanceRepository friendBalanceRepository;
    private final GroupRepository groupRepository;
    private final SettlementRecordRepository settlementRecordRepository;
    private final SplitCalculationService splitCalculationService;

    public User getUserById(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new ApiException("User not found", HttpStatus.NOT_FOUND));
    }

    public User updateProfile(String userId, String fullName) {
        User user = getUserById(userId);
        user.setFullName(fullName);
        return userRepository.save(user);
    }

    public UserStats getUserStats(String userId) {
        // Get all bills where user is paidBy or appears in any item's sharedByUserIds
        List<Bill> allBills = billRepository.findAll();
        long totalBills = allBills.stream()
                .filter(bill -> {
                    // Check if user is the one who paid
                    if (userId.equals(bill.getPaidBy())) {
                        return true;
                    }
                    // Check if user appears in any bill item's sharedByUserIds
                    if (bill.getItems() != null) {
                        return bill.getItems().stream()
                                .anyMatch(item -> item.getSharedByUserIds() != null 
                                        && item.getSharedByUserIds().contains(userId));
                    }
                    return false;
                })
                .count();

        // Get groups count where user is a member
        long groupsCount = groupRepository.findByMemberIdsContaining(userId).size();

        // Get friends count - unique users across all groups excluding themselves
        List<Group> userGroups = groupRepository.findByMemberIdsContaining(userId);
        Set<String> uniqueFriendIds = new HashSet<>();
        for (Group group : userGroups) {
            if (group.getMemberIds() != null) {
                for (String memberId : group.getMemberIds()) {
                    if (!memberId.equals(userId)) {
                        uniqueFriendIds.add(memberId);
                    }
                }
            }
        }
        long friendsCount = uniqueFriendIds.size();

        return new UserStats(totalBills, groupsCount, friendsCount);
    }

    public String getCurrentUserId() {
        String email = SecurityContextHolder.getContext().getAuthentication().getName();
        return userRepository.findByEmail(email).get().getId();
    }

    public List<String> getFriendIds(String userId) {
        List<Group> userGroups = groupRepository.findByMemberIdsContaining(userId);
        Set<String> friendIds = new HashSet<>();
        for (Group group : userGroups) {
            if (group.getMemberIds() != null) {
                for (String memberId : group.getMemberIds()) {
                    if (!memberId.equals(userId)) {
                        friendIds.add(memberId);
                    }
                }
            }
        }
        return new ArrayList<>(friendIds);
    }

    /**
     * Gets ALL users the user has a relationship with - both explicitly added friends
     * AND group co-members. This unified list is used for the Friends screen.
     */
    public List<FriendBalance> getAllFriendBalances(String userId) {
        // 1. Get explicit friend balances from the FriendBalance collection
        List<FriendBalance> explicitBalances = friendBalanceRepository.findByUserId(userId);
        
        // 2. Get all groups where the user is a member
        List<Group> userGroups = groupRepository.findByMemberIdsContaining(userId);
        
        // 3. Collect all other member IDs from those groups (group co-members)
        //    and track active group IDs so we can filter out bills from deleted groups.
        Set<String> groupCoMemberIds = new HashSet<>();
        Set<String> activeGroupIds = new HashSet<>();
        for (Group group : userGroups) {
            activeGroupIds.add(group.getId());
            if (group.getMemberIds() != null) {
                for (String memberId : group.getMemberIds()) {
                    if (!memberId.equals(userId)) {
                        groupCoMemberIds.add(memberId);
                    }
                }
            }
        }
        
        // 4. Get balances for group co-members from bills by calculating net balances
        //    We need to find all bills where these group co-members are participants
        List<FriendBalance> groupCoMemberBalances = new ArrayList<>();
        
        if (!groupCoMemberIds.isEmpty()) {
            // Get all bills involving these users
            List<Bill> allBills = billRepository.findAll();
            
            // Calculate net balance for each group co-member
            Map<String, Double> coMemberNetBalances = new HashMap<>();
            
            for (Bill bill : allBills) {
                // Skip bills that belong to deleted groups (orphaned bills)
                if (bill.getGroupId() == null || !activeGroupIds.contains(bill.getGroupId())) {
                    continue;
                }
                
                // Skip personal expenses (no group or only 1 unique participant)
                if (isPersonalExpense(bill)) {
                    continue;
                }
                
                // Get all unique participants in this bill
                Set<String> participants = new HashSet<>();
                for (BillItem item : bill.getItems()) {
                    if (item.getSharedByUserIds() != null) {
                        participants.addAll(item.getSharedByUserIds());
                    }
                }
                
                // If this bill involves any of our group co-members, calculate their share
                for (String participantId : participants) {
                    if (groupCoMemberIds.contains(participantId)) {
                        // Calculate the share for this participant in this bill
                        double share = splitCalculationService.calculateIndividualShares(bill).getOrDefault(participantId, 0.0);
                        coMemberNetBalances.put(participantId, 
                            coMemberNetBalances.getOrDefault(participantId, 0.0) + share);
                    }
                }
            }
            
            // Create FriendBalance entries for group co-members with non-zero balances
            for (Map.Entry<String, Double> entry : coMemberNetBalances.entrySet()) {
                if (Math.abs(entry.getValue()) > 0.01) {
                    FriendBalance fb = new FriendBalance();
                    fb.setUserId(userId);
                    fb.setFriendId(entry.getKey());
                    fb.setNetBalance(entry.getValue());
                    groupCoMemberBalances.add(fb);
                }
            }
        }
        
        // 5. Combine explicit friend balances with group co-member balances.
        //    Dynamic group co-member balances take precedence so new bills
        //    in new groups show up correctly.
        Map<String, FriendBalance> combinedMap = new LinkedHashMap<>();
        
        // Add explicit friend balances first
        for (FriendBalance fb : explicitBalances) {
            combinedMap.put(fb.getFriendId(), fb);
        }
        
        // Add/override with group co-member balances (dynamic computation wins)
        for (FriendBalance fb : groupCoMemberBalances) {
            combinedMap.put(fb.getFriendId(), fb);
        }

        // 6. Apply PAID settlement adjustments to balances.
        //    When the user settles up with a friend, PAID settlement records
        //    are created. Those amounts are applied here directionally:
        //    - If I paid the friend (fromUserId = me): my debt decreases, so
        //      my balance goes up (adds to the balance, making it less negative).
        //    - If the friend paid me (toUserId = me): their debt to me decreases,
        //      so my balance goes down (subtract from the balance).
        //    This is fully dynamic — if new bills are added later, the balance
        //    grows again and correctly shows the new amount owed.
        for (FriendBalance fb : combinedMap.values()) {
            List<SettlementRecord> paidWithFriend = settlementRecordRepository
                    .findSettlementsBetweenUsersAndStatus(userId, fb.getFriendId(), SettlementRecord.Status.PAID);
            double adjustment = 0;
            for (SettlementRecord sr : paidWithFriend) {
                if (sr.getAmount() == null) continue;
                if (userId.equals(sr.getFromUserId())) {
                    // I paid the friend — reduces what I owe
                    adjustment += sr.getAmount();
                } else if (userId.equals(sr.getToUserId())) {
                    // Friend paid me — reduces what they owe me
                    adjustment -= sr.getAmount();
                }
            }
            if (adjustment != 0) {
                double current = fb.getNetBalance() != null ? fb.getNetBalance() : 0.0;
                fb.setNetBalance(current + adjustment);
            }
        }
        
        return new ArrayList<>(combinedMap.values());
    }

    private boolean isPersonalExpense(Bill bill) {
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
     * Calculates individual shares for a bill (de-duplicated).
     */
    public Map<String, Double> calculateIndividualShares(Bill bill) {
        return splitCalculationService.calculateIndividualShares(bill);
    }

    public List<List<String>> getSettlementsForUser(String userId) {
        // Get all net balances for this user's groups and combine with friend balances
        List<Group> userGroups = groupRepository.findByMemberIdsContaining(userId);
        Map<String, Double> allNetBalances = new HashMap<>();
        
        // Add balances from all user's groups
        for (Group group : userGroups) {
            Map<String, Double> groupBalances = splitCalculationService.calculateNetBalancesForGroup(group.getId());
            allNetBalances.putAll(groupBalances);
        }
        
        // Add explicit friend balances
        List<FriendBalance> friendBalances = friendBalanceRepository.findByUserId(userId);
        for (FriendBalance fb : friendBalances) {
            allNetBalances.put(fb.getFriendId(), fb.getNetBalance());
        }
        
        // Simplify debts - returns List<Settlement> but we need to convert to List<List<String>>
        // For now, return empty list since Settlement class doesn't exist in this project
        // The frontend can use the friend balances directly
        return Collections.emptyList();
    }
}
