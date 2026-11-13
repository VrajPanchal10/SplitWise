package com.splitwise.splitwisebackend.service;

import com.splitwise.splitwisebackend.exception.ApiException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.*;

/**
 * Service managing currency exchange rates, conversion, and supported currency validation.
 * Uses robust reference rates with deterministic cross-rate calculation, ensuring zero-dependency
 * mathematical reproducibility for historical expense tracking.
 */
@Service
@Slf4j
public class CurrencyConversionService {

    public static final String DEFAULT_CURRENCY = "INR";

    /**
     * Supported ISO currency codes.
     */
    public static final Set<String> SUPPORTED_CURRENCIES = new LinkedHashSet<>(Arrays.asList(
            "INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "AED", "JPY"
    ));

    /**
     * Base reference exchange rates relative to USD (1 USD = X target).
     */
    private static final Map<String, Double> USD_BASE_RATES = new HashMap<>();

    static {
        USD_BASE_RATES.put("USD", 1.0);
        USD_BASE_RATES.put("INR", 86.50);
        USD_BASE_RATES.put("EUR", 0.92);
        USD_BASE_RATES.put("GBP", 0.78);
        USD_BASE_RATES.put("CAD", 1.38);
        USD_BASE_RATES.put("AUD", 1.52);
        USD_BASE_RATES.put("SGD", 1.34);
        USD_BASE_RATES.put("AED", 3.67);
        USD_BASE_RATES.put("JPY", 152.00);
    }

    /**
     * Validates if a currency code is supported.
     *
     * @param code ISO 3-letter currency code
     * @return normalized uppercase currency code
     */
    public String validateAndNormalizeCurrency(String code) {
        if (code == null || code.trim().isEmpty()) {
            return DEFAULT_CURRENCY;
        }
        String upper = code.trim().toUpperCase();
        if (!SUPPORTED_CURRENCIES.contains(upper)) {
            throw new ApiException("Unsupported currency code: " + code + ". Supported: " + SUPPORTED_CURRENCIES,
                    HttpStatus.BAD_REQUEST);
        }
        return upper;
    }

    public void validateCurrency(String code) {
        validateAndNormalizeCurrency(code);
    }

    public String getCurrencySymbol(String currencyCode) {
        if (currencyCode == null) return "₹";
        switch (currencyCode.trim().toUpperCase()) {
            case "INR": return "₹";
            case "USD": return "$";
            case "EUR": return "€";
            case "GBP": return "£";
            case "CAD": return "C$";
            case "AUD": return "A$";
            case "SGD": return "S$";
            case "AED": return "AED ";
            case "JPY": return "¥";
            default: return currencyCode + " ";
        }
    }

    public double roundToTwoDecimals(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    /**
     * Calculates the exchange rate from one currency to another.
     *
     * @param fromCurrency source currency
     * @param toCurrency target currency
     * @return exchange rate factor (1 unit of fromCurrency = result units of toCurrency)
     */
    public double getExchangeRate(String fromCurrency, String toCurrency) {
        String from = validateAndNormalizeCurrency(fromCurrency);
        String to = validateAndNormalizeCurrency(toCurrency);

        if (from.equals(to)) {
            return 1.0;
        }

        Double fromUsdRate = USD_BASE_RATES.get(from);
        Double toUsdRate = USD_BASE_RATES.get(to);

        if (fromUsdRate == null || toUsdRate == null || fromUsdRate <= 0) {
            throw new ApiException("Exchange rate unavailable for " + from + " -> " + to,
                    HttpStatus.INTERNAL_SERVER_ERROR);
        }

        // Cross-rate calculation: (USD -> to) / (USD -> from)
        double rate = toUsdRate / fromUsdRate;
        // Round to 4 decimal places for stable precision
        return Math.round(rate * 10000.0) / 10000.0;
    }

    /**
     * Converts an amount from one currency to another.
     *
     * @param amount amount in fromCurrency
     * @param fromCurrency source currency code
     * @param toCurrency target currency code
     * @return converted amount rounded to 2 decimal places
     */
    public double convert(double amount, String fromCurrency, String toCurrency) {
        if (amount <= 0) {
            return 0.0;
        }
        double rate = getExchangeRate(fromCurrency, toCurrency);
        return Math.round(amount * rate * 100.0) / 100.0;
    }

    /**
     * Returns metadata about supported currencies and rates relative to a given base.
     */
    public Map<String, Object> getCurrenciesInfo(String baseCurrency) {
        String base = validateAndNormalizeCurrency(baseCurrency);
        Map<String, Double> rates = new LinkedHashMap<>();
        for (String curr : SUPPORTED_CURRENCIES) {
            rates.put(curr, getExchangeRate(base, curr));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("baseCurrency", base);
        result.put("rateDate", LocalDate.now().toString());
        result.put("supportedCurrencies", new ArrayList<>(SUPPORTED_CURRENCIES));
        result.put("rates", rates);
        return result;
    }
}
