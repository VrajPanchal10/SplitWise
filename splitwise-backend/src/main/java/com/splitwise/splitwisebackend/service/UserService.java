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
    private final CurrencyConversionService currencyConversionService;

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
        //    and track active group IDs.
        Set<String> groupCoMemberIds = new HashSet<>();
        Set<String> activeGroupIds = new HashSet<>();
        for (Group group : userGroups) {
            if (group.getId() != null) {
                activeGroupIds.add(group.getId());
            }
            if (group.getMemberIds() != null) {
                for (String memberId : group.getMemberIds()) {
                    if (memberId != null && !memberId.equals(userId)) {
                        groupCoMemberIds.add(memberId);
                    }
                }
            }
        }
        
        // 4. Calculate pairwise balances with friends/co-members:
        //    A) From group settlements (the canonical simplified debts per group)
        Map<String, Double> dynamicBalances = new HashMap<>();

        for (Group group : userGroups) {
            if (group.getId() == null) continue;
            List<com.splitwise.splitwisebackend.dto.Settlement> groupSettlements =
                    splitCalculationService.getSettlementsForGroup(group.getId());
            if (groupSettlements == null) continue;

            for (com.splitwise.splitwisebackend.dto.Settlement s : groupSettlements) {
                if (s.getToUserId() != null && s.getToUserId().equals(userId)) {
                    // fromUserId owes current user (+amount)
                    String friendId = s.getFromUserId();
                    if (friendId != null && !friendId.equals(userId)) {
                        dynamicBalances.put(friendId,
                                roundToTwoDecimals(dynamicBalances.getOrDefault(friendId, 0.0) + s.getAmount()));
                    }
                } else if (s.getFromUserId() != null && s.getFromUserId().equals(userId)) {
                    // Current user owes toUserId (-amount)
                    String friendId = s.getToUserId();
                    if (friendId != null && !friendId.equals(userId)) {
                        dynamicBalances.put(friendId,
                                roundToTwoDecimals(dynamicBalances.getOrDefault(friendId, 0.0) - s.getAmount()));
                    }
                }
            }
        }

        //    B) For direct 1-on-1 / non-group bills involving userId and friends
        List<Bill> allBills = billRepository.findAll();
        for (Bill bill : allBills) {
            if (bill.getGroupId() != null && activeGroupIds.contains(bill.getGroupId())) {
                // Group bills are already accounted for by getSettlementsForGroup above
                continue;
            }
            if (isPersonalExpense(bill)) {
                continue;
            }

            Map<String, Double> inrShares = splitCalculationService.calculateIndividualInrShares(bill);
            String payer = bill.getPaidBy();
            if (payer == null) continue;

            if (payer.equals(userId)) {
                // Current user paid: other participants owe user their share in INR
                for (Map.Entry<String, Double> entry : inrShares.entrySet()) {
                    String friendId = entry.getKey();
                    if (friendId != null && !friendId.equals(userId)) {
                        dynamicBalances.put(friendId,
                                roundToTwoDecimals(dynamicBalances.getOrDefault(friendId, 0.0) + entry.getValue()));
                    }
                }
            } else if (inrShares.containsKey(userId)) {
                // Friend paid: current user owes friend user's share in INR
                double userShare = inrShares.get(userId);
                if (!payer.equals(userId)) {
                    dynamicBalances.put(payer,
                            roundToTwoDecimals(dynamicBalances.getOrDefault(payer, 0.0) - userShare));
                }
            }
        }

        // 5. Combine explicit friend balances with dynamically computed balances
        Map<String, FriendBalance> combinedMap = new LinkedHashMap<>();

        // Add explicit friend balances first
        for (FriendBalance fb : explicitBalances) {
            if (fb.getFriendId() != null && !fb.getFriendId().equals(userId)) {
                combinedMap.put(fb.getFriendId(), fb);
            }
        }

        // Add/override with dynamically computed balances
        for (Map.Entry<String, Double> entry : dynamicBalances.entrySet()) {
            String friendId = entry.getKey();
            if (friendId.equals(userId)) continue; // Never owe oneself

            FriendBalance fb = combinedMap.getOrDefault(friendId, new FriendBalance());
            fb.setUserId(userId);
            fb.setFriendId(friendId);
            fb.setNetBalance(roundToTwoDecimals(entry.getValue()));
            combinedMap.put(friendId, fb);
        }

        // Ensure all group co-members exist in combinedMap (even if settled at 0.0)
        for (String coMemberId : groupCoMemberIds) {
            if (!coMemberId.equals(userId)) {
                if (!dynamicBalances.containsKey(coMemberId)) {
                    // No remaining simplified group debt: explicitly set to 0.0
                    FriendBalance fb = combinedMap.getOrDefault(coMemberId, new FriendBalance());
                    fb.setUserId(userId);
                    fb.setFriendId(coMemberId);
                    fb.setNetBalance(0.0);
                    combinedMap.put(coMemberId, fb);
                }
            }
        }

        // 6. Apply PAID settlement adjustments for non-group settlements (strictly in INR)
        for (FriendBalance fb : combinedMap.values()) {
            List<SettlementRecord> paidWithFriend = settlementRecordRepository
                    .findSettlementsBetweenUsersAndStatus(userId, fb.getFriendId(), SettlementRecord.Status.PAID);
            double adjustment = 0;
            for (SettlementRecord sr : paidWithFriend) {
                // Skip group settlements since getSettlementsForGroup already deducted them
                if (sr.getGroupId() != null && activeGroupIds.contains(sr.getGroupId())) {
                    continue;
                }
                if (sr.getAmount() == null) continue;
                double settleAmount = sr.getAmount();
                if (sr.getCurrency() != null && !sr.getCurrency().equalsIgnoreCase("INR") && currencyConversionService != null) {
                    double rate = currencyConversionService.getExchangeRate(sr.getCurrency(), "INR");
                    settleAmount = roundToTwoDecimals(settleAmount * rate);
                }
                if (userId.equals(sr.getFromUserId())) {
                    // I paid friend: debt decreases
                    adjustment += settleAmount;
                } else if (userId.equals(sr.getToUserId())) {
                    // Friend paid me: credit decreases
                    adjustment -= settleAmount;
                }
            }
            if (adjustment != 0) {
                double current = fb.getNetBalance() != null ? fb.getNetBalance() : 0.0;
                fb.setNetBalance(roundToTwoDecimals(current + adjustment));
            }
        }

        return new ArrayList<>(combinedMap.values());
    }

    private static double roundToTwoDecimals(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private boolean isPersonalExpense(Bill bill) {
        if (bill == null) {
            return true;
        }

        if (bill.getItems() == null || bill.getItems().isEmpty()) {
            return true;
        }

        // Collect all unique persons involved (payer + all item participants)
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

        return persons.size() <= 1;
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
