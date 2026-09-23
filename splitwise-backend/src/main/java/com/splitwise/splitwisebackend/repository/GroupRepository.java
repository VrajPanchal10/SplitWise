package com.splitwise.splitwisebackend.repository;

import com.splitwise.splitwisebackend.model.Group;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface GroupRepository extends MongoRepository<Group, String> {
    List<Group> findByMemberIdsContaining(String userId);
}