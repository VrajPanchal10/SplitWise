package com.splitwise.splitwisebackend.controller;

import com.splitwise.splitwisebackend.service.CurrencyConversionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/currencies")
@RequiredArgsConstructor
public class CurrencyController {

    private final CurrencyConversionService currencyConversionService;

    @GetMapping
    public ResponseEntity<Map<String, Object>> getCurrencies(
            @RequestParam(value = "base", defaultValue = "INR") String baseCurrency) {
        return ResponseEntity.ok(currencyConversionService.getCurrenciesInfo(baseCurrency));
    }

    @GetMapping("/rate")
    public ResponseEntity<Map<String, Object>> getRate(
            @RequestParam("from") String from,
            @RequestParam("to") String to) {
        double rate = currencyConversionService.getExchangeRate(from, to);
        return ResponseEntity.ok(Map.of(
                "from", currencyConversionService.validateAndNormalizeCurrency(from),
                "to", currencyConversionService.validateAndNormalizeCurrency(to),
                "rate", rate
        ));
    }
}
