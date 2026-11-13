package com.splitwise.splitwisebackend.controller;

import com.splitwise.splitwisebackend.dto.BillBreakdownResponse;
import com.splitwise.splitwisebackend.dto.CreateBillRequest;
import com.splitwise.splitwisebackend.dto.Settlement;
import com.splitwise.splitwisebackend.model.Bill;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.UserRepository;
import com.splitwise.splitwisebackend.service.BillService;
import com.splitwise.splitwisebackend.service.SplitCalculationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.Collections;
import java.util.List;

@RestController
@RequestMapping("/api/bills")
@RequiredArgsConstructor
@Slf4j
public class BillController {

    private final BillService billService;
    private final SplitCalculationService splitCalculationService;
    private final UserRepository userRepository;

    private String getCurrentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        String email = authentication.getName();
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found"));
        return user.getId();
    }

    @PostMapping
    public ResponseEntity<Bill> createBill(@Valid @RequestBody CreateBillRequest request) {
        Bill bill = billService.createBill(request);
        return ResponseEntity.ok(bill);
    }

    @GetMapping("/group/{groupId}")
    public ResponseEntity<List<Bill>> getBillsByGroup(@PathVariable("groupId") String groupId) {
        List<Bill> bills = billService.getBillsByGroup(groupId);
        return ResponseEntity.ok(bills);
    }

    @GetMapping("/with-friend/{friendId}")
    public ResponseEntity<List<Bill>> getBillsWithFriend(@PathVariable("friendId") String friendId) {
        String userId = getCurrentUserId();
        List<Bill> bills = billService.getBillsWithFriend(userId, friendId);
        return ResponseEntity.ok(bills);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Bill> getBill(@PathVariable("id") String id) {
        Bill bill = billService.getBillById(id);
        return ResponseEntity.ok(bill);
    }

    @GetMapping("/{id}/breakdown")
    public ResponseEntity<BillBreakdownResponse> getBillBreakdown(@PathVariable("id") String id) {
        Bill bill = billService.getBillById(id);
        BillBreakdownResponse breakdown = splitCalculationService.calculateBillBreakdown(bill);
        return ResponseEntity.ok(breakdown);
    }

    @PutMapping("/{id}")
    public ResponseEntity<Bill> updateBill(@PathVariable("id") String id, @Valid @RequestBody CreateBillRequest request) {
        Bill bill = billService.updateBill(id, request);
        return ResponseEntity.ok(bill);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteBill(@PathVariable("id") String id) {
        Bill bill = billService.getBillById(id);
        String currentUserId = getCurrentUserId();
        
        if (!currentUserId.equals(bill.getPaidBy())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        
        billService.deleteBill(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/group/{groupId}/settlements")
    public ResponseEntity<List<Settlement>> getSettlementsForGroup(@PathVariable("groupId") String groupId) {
        try {
            List<Settlement> settlements = splitCalculationService.getSettlementsForGroup(groupId);
            return ResponseEntity.ok(settlements);
        } catch (Exception e) {
            log.error("Error calculating settlements for group {}: ", groupId, e);
            return ResponseEntity.ok(Collections.emptyList());
        }
    }

    @GetMapping("/mine")
    public ResponseEntity<List<Bill>> getMyBills() {
        String userId = getCurrentUserId();
        List<Bill> bills = billService.getAllBillsForUser(userId);
        return ResponseEntity.ok(bills);
    }
}
