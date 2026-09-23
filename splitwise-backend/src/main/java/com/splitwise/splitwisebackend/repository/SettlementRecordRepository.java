package com.splitwise.splitwisebackend.repository;

import com.splitwise.splitwisebackend.model.SettlementRecord;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;

import java.util.List;

public interface SettlementRecordRepository extends MongoRepository<SettlementRecord, String> {
    List<SettlementRecord> findByGroupIdAndStatus(String groupId, SettlementRecord.Status status);

    List<SettlementRecord> findByGroupId(String groupId);

    @Query("{ $or: [ { 'fromUserId': ?0, 'toUserId': ?1, 'status': ?2 }, { 'fromUserId': ?1, 'toUserId': ?0, 'status': ?2 } ] }")
    List<SettlementRecord> findSettlementsBetweenUsersAndStatus(String userId1, String userId2, SettlementRecord.Status status);
}
