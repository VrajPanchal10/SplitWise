package com.splitwise.splitwisebackend.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;

/**
 * A single entry in the user's activity feed.
 *
 * Each record represents one notable action that happened in the app and is
 * relevant to {@code userId} (the feed owner). For shared activities (e.g. a
 * group-mate adding an expense), the same activity is stored once per
 * affected user with {@code actorUserId} recording who actually performed it.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "activities")
public class Activity {
    @Id
    private String id;

    /** The user this activity belongs to (for filtering "my feed"). */
    private String userId;

    /**
     * Type of activity, e.g. "GROUP_CREATED", "MEMBER_ADDED", "EXPENSE_ADDED",
     * "EXPENSE_SETTLED", "PROFILE_PHOTO_CHANGED".
     */
    private String type;

    /** Human-readable text, e.g. "You created group 'Flatmates'". */
    private String description;

    /** Group this activity relates to, if any. */
    private String relatedGroupId;

    /** Bill/expense this activity relates to, if any. */
    private String relatedBillId;

    /** Who performed the action (may differ from userId for shared activities). */
    private String actorUserId;

    private LocalDateTime createdAt;
}