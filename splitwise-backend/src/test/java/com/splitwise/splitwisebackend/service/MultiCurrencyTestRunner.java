package com.splitwise.splitwisebackend.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

public class MultiCurrencyTestRunner {
    public static void main(String[] args) {
        System.out.println("==================================================");
        System.out.println("Running MultiCurrencyTest...");
        System.out.println("==================================================");
        int passed = 0;
        int failed = 0;
        List<String> failedNames = new ArrayList<>();

        Class<?>[] testClasses = new Class<?>[] {
                MultiCurrencyTest.class,
                SplitCalculationServiceTest.class
        };

        for (Class<?> clazz : testClasses) {
            System.out.println("Running " + clazz.getSimpleName() + "...");
            for (Method m : clazz.getDeclaredMethods()) {
                if (m.isAnnotationPresent(Test.class)) {
                    String testName = m.getName();
                    if (m.isAnnotationPresent(DisplayName.class)) {
                        testName = m.getAnnotation(DisplayName.class).value();
                    }
                    try {
                        Object instance = clazz.getDeclaredConstructor().newInstance();
                        org.mockito.MockitoAnnotations.openMocks(instance);
                        for (Method setup : clazz.getDeclaredMethods()) {
                            if (setup.isAnnotationPresent(BeforeEach.class)) {
                                setup.setAccessible(true);
                                setup.invoke(instance);
                            }
                        }
                        m.setAccessible(true);
                        m.invoke(instance);
                        System.out.println("  PASS: [" + clazz.getSimpleName() + "] " + testName);
                        passed++;
                    } catch (Exception e) {
                        Throwable cause = e.getCause() != null ? e.getCause() : e;
                        System.err.println("  FAIL: [" + clazz.getSimpleName() + "] " + testName + " -> " + cause.getMessage());
                        cause.printStackTrace();
                        failed++;
                        failedNames.add(clazz.getSimpleName() + "." + testName);
                    }
                }
            }
        }

        System.out.println("==================================================");
        System.out.println("All Service Test Results: " + passed + " passed, " + failed + " failed.");
        System.out.println("==================================================");

        if (failed > 0) {
            System.err.println("FAILED TESTS:");
            for (String f : failedNames) {
                System.err.println(" - " + f);
            }
            System.exit(1);
        }
    }
}
