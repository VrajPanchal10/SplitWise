package com.splitwise.splitwisebackend.controller;

import com.splitwise.splitwisebackend.dto.CreateBillRequest;
import com.splitwise.splitwisebackend.dto.Settlement;
import com.splitwise.splitwisebackend.model.Bill;
import com.splitwise.splitwisebackend.model.User;
import com.splitwise.splitwisebackend.repository.UserRepository;
import com.splitwise.splitwisebackend.service.BillService;
import com.splitwise.splitwisebackend.service.SplitCalculationService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/bills")
@RequiredArgsConstructor
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
    public ResponseEntity<List<Bill>> getBillsByGroup(@PathVariable String groupId) {
        List<Bill> bills = billService.getBillsByGroup(groupId);
        return ResponseEntity.ok(bills);
    }

    @GetMapping("/with-friend/{friendId}")
    public ResponseEntity<List<Bill>> getBillsWithFriend(@PathVariable String friendId) {
        String userId = getCurrentUserId();
        List<Bill> bills = billService.getBillsWithFriend(userId, friendId);
        return ResponseEntity.ok(bills);
    }

    @GetMapping("/{id}")
    public ResponseEntity<Bill> getBill(@PathVariable String id) {
        Bill bill = billService.getBillById(id);
        return ResponseEntity.ok(bill);
    }

    @PutMapping("/{id}")
    public ResponseEntity<Bill> updateBill(@PathVariable String id, @Valid @RequestBody CreateBillRequest request) {
        Bill bill = billService.updateBill(id, request);
        return ResponseEntity.ok(bill);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteBill(@PathVariable String id) {
        Bill bill = billService.getBillById(id);
        String currentUserId = getCurrentUserId();
        
        if (!currentUserId.equals(bill.getPaidBy())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        }
        
        billService.deleteBill(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/group/{groupId}/settlements")
    public ResponseEntity<List<Settlement>> getSettlementsForGroup(@PathVariable String groupId) {
        List<Settlement> settlements = splitCalculationService.getSettlementsForGroup(groupId);
        return ResponseEntity.ok(settlements);
    }

    @GetMapping("/mine")
    public ResponseEntity<List<Bill>> getMyBills() {
        String userId = getCurrentUserId();
        List<Bill> bills = billService.getAllBillsForUser(userId);
        return ResponseEntity.ok(bills);
    }
}
