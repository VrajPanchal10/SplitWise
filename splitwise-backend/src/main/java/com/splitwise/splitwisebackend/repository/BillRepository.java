package com.splitwise.splitwisebackend.repository;

import com.splitwise.splitwisebackend.model.Bill;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface BillRepository extends MongoRepository<Bill, String> {
    List<Bill> findByGroupId(String groupId);
    List<Bill> findByPaidBy(String paidBy);
    List<Bill> findByItemsSharedByUserIdsContaining(String userId);
}
