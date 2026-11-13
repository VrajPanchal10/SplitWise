package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.model.Activity;
import com.splitwise.splitwisebackend.repository.ActivityRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

/**
 * Records and retrieves user activity-feed entries.
 *
 * Other services call {@link #logActivity} whenever something notable happens
 * (group created, member added, expense added/settled, profile photo changed,
 * etc.). Each call persists one {@link Activity} document for the affected
 * user; for shared activities (e.g. a group-mate's action), call it once per
 * user who should see it in their feed.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ActivityService {

    private final ActivityRepository activityRepository;

    /**
     * Creates and saves an Activity record.
     *
     * @param userId         the user this activity belongs to (feed owner)
     * @param type           activity type, e.g. "GROUP_CREATED", "EXPENSE_ADDED"
     * @param description    human-readable text, e.g. "You created group 'Flatmates'"
     * @param relatedGroupId group id this relates to (nullable)
     * @param relatedBillId  bill id this relates to (nullable)
     * @param actorUserId    who performed the action (nullable; defaults to userId)
     */
    public void logActivity(String userId, String type, String description,
                            String relatedGroupId, String relatedBillId,
                            String actorUserId) {
        logActivity(userId, type, description, relatedGroupId, relatedBillId, actorUserId, null, null);
    }

    /**
     * Creates and saves an Activity record with optional groupName and amount.
     *
     * @param userId         the user this activity belongs to (feed owner)
     * @param type           activity type, e.g. "GROUP_CREATED", "EXPENSE_ADDED", "EXPENSE_SETTLED"
     * @param description    human-readable text, e.g. "Mehr paid Vraj"
     * @param relatedGroupId group id this relates to (nullable)
     * @param relatedBillId  bill id this relates to (nullable)
     * @param actorUserId    who performed the action (nullable; defaults to userId)
     * @param groupName      name of the group (nullable)
     * @param amount         settlement or expense amount (nullable)
     */
    public void logActivity(String userId, String type, String description,
                            String relatedGroupId, String relatedBillId,
                            String actorUserId, String groupName, Double amount) {
        try {
            Activity activity = new Activity();
            activity.setUserId(userId);
            activity.setType(type);
            activity.setDescription(description);
            activity.setRelatedGroupId(relatedGroupId);
            activity.setRelatedBillId(relatedBillId);
            activity.setActorUserId(actorUserId != null ? actorUserId : userId);
            activity.setGroupName(groupName);
            activity.setAmount(amount);
            activity.setCreatedAt(LocalDateTime.now(ZoneOffset.UTC));

            activityRepository.save(activity);
            log.debug("Logged activity: type={}, userId={}, actor={}, group={}, amount={}",
                    type, userId, activity.getActorUserId(), groupName, amount);
        } catch (Exception e) {
            // Never let activity logging break the main business flow
            log.error("Failed to log activity: type={}, userId={}", type, userId, e);
        }
    }

    /**
     * Returns the most recent activities for a user, newest first.
     *
     * @param userId the feed owner
     * @param limit  maximum number of entries to return (e.g. 50)
     */
    public List<Activity> getRecentActivities(String userId, int limit) {
        List<Activity> activities = activityRepository.findByUserIdOrderByCreatedAtDesc(userId);
        if (activities.size() > limit) {
            return activities.subList(0, limit);
        }
        return activities;
    }
}