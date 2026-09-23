package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.exception.ApiException;
import com.splitwise.splitwisebackend.model.Bill;
import com.splitwise.splitwisebackend.model.Group;
import com.splitwise.splitwisebackend.model.SettlementRecord;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.BillRepository;
import com.splitwise.splitwisebackend.repository.GroupRepository;
import com.splitwise.splitwisebackend.repository.SettlementRecordRepository;
import com.splitwise.splitwisebackend.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class GroupService {

    private final GroupRepository groupRepository;
    private final BillRepository billRepository;
    private final SettlementRecordRepository settlementRecordRepository;
    private final UserRepository userRepository;
    private final ActivityService activityService;

    public Group createGroup(String name, List<String> memberIds, String createdBy) {
        List<String> members = Optional.ofNullable(memberIds).orElse(List.of());
        if (!members.contains(createdBy)) {
            members = new java.util.ArrayList<>(members);
            members.add(createdBy);
        }

        Group group = new Group();
        group.setName(name);
        group.setMemberIds(members);
        group.setCreatedBy(createdBy);
        group.setCreatedAt(LocalDateTime.now());

        Group saved = groupRepository.save(group);

        // Activity feed: notify the creator
        activityService.logActivity(
                createdBy,
                "GROUP_CREATED",
                "You created group '" + name + "'",
                saved.getId(),
                null,
                createdBy);

        return saved;
    }

    public List<Group> getGroupsForUser(String userId) {
        return groupRepository.findByMemberIdsContaining(userId);
    }

    public Group getGroupById(String groupId) {
        return groupRepository.findById(groupId)
                .orElseThrow(() -> new ApiException("Group not found", HttpStatus.NOT_FOUND));
    }

    public Group addMemberToGroup(String groupId, String userId) {
        Group group = getGroupById(groupId);
        boolean alreadyMember = group.getMemberIds().contains(userId);
        if (!alreadyMember) {
            group.getMemberIds().add(userId);
        }
        Group saved = groupRepository.save(group);

        // Activity feed: notify all group members about the join
        if (!alreadyMember) {
            String memberName = userRepository.findById(userId)
                    .map(User::getFullName)
                    .orElse("A new member");

            for (String memberId : saved.getMemberIds()) {
                if (memberId.equals(userId)) {
                    // The new member themselves
                    activityService.logActivity(
                            memberId,
                            "MEMBER_ADDED",
                            "You joined '" + group.getName() + "'",
                            saved.getId(),
                            null,
                            userId);
                } else {
                    // Existing members see who joined
                    activityService.logActivity(
                            memberId,
                            "MEMBER_ADDED",
                            memberName + " joined '" + group.getName() + "'",
                            saved.getId(),
                            null,
                            userId);
                }
            }
        }

        return saved;
    }

    public Group removeMemberFromGroup(String groupId, String userId) {
        Group group = getGroupById(groupId);
        if (group.getMemberIds().contains(userId)) {
            group.getMemberIds().remove(userId);
        }
        return groupRepository.save(group);
    }

    public void deleteGroup(String groupId, String userId) {
        Group group = getGroupById(groupId);
        if (!group.getCreatedBy().equals(userId)) {
            throw new ApiException("Only the group creator can delete this group", HttpStatus.FORBIDDEN);
        }

        // Clean up all bills associated with this group so they don't
        // leave orphaned data that pollutes friend balance calculations.
        List<Bill> groupBills = billRepository.findByGroupId(groupId);
        if (!groupBills.isEmpty()) {
            billRepository.deleteAll(groupBills);
        }

        // Clean up all settlement records associated with this group.
        List<SettlementRecord> groupSettlements = settlementRecordRepository.findByGroupId(groupId);
        if (!groupSettlements.isEmpty()) {
            settlementRecordRepository.deleteAll(groupSettlements);
        }

        groupRepository.deleteById(groupId);
    }
}
