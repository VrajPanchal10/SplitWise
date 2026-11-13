package com.splitwise.splitwisebackend.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;

public class OcrTestRunner {
    public static void main(String[] args) {
        System.out.println("Running ReceiptParserServiceTest...");
        int passed = 0;
        int failed = 0;
        List<String> failedNames = new ArrayList<>();

        Class<?> outerClass = ReceiptParserServiceTest.class;
        List<Class<?>> testClasses = new ArrayList<>();
        testClasses.add(outerClass);
        for (Class<?> nested : outerClass.getDeclaredClasses()) {
            if (nested.isAnnotationPresent(Nested.class) || !Modifier.isAbstract(nested.getModifiers())) {
                testClasses.add(nested);
            }
        }

        for (Class<?> clazz : testClasses) {
            for (Method m : clazz.getDeclaredMethods()) {
                if (m.isAnnotationPresent(Test.class)) {
                    String testName = clazz.getSimpleName() + "." + m.getName();
                    try {
                        Object instance;
                        if (clazz == outerClass) {
                            instance = outerClass.getDeclaredConstructor().newInstance();
                            for (Method setup : outerClass.getDeclaredMethods()) {
                                if (setup.isAnnotationPresent(BeforeEach.class)) {
                                    setup.setAccessible(true);
                                    setup.invoke(instance);
                                }
                            }
                        } else {
                            Object outerInstance = outerClass.getDeclaredConstructor().newInstance();
                            for (Method setup : outerClass.getDeclaredMethods()) {
                                if (setup.isAnnotationPresent(BeforeEach.class)) {
                                    setup.setAccessible(true);
                                    setup.invoke(outerInstance);
                                }
                            }
                            Constructor<?> ctor = clazz.getDeclaredConstructor(outerClass);
                            ctor.setAccessible(true);
                            instance = ctor.newInstance(outerInstance);
                            for (Method setup : clazz.getDeclaredMethods()) {
                                if (setup.isAnnotationPresent(BeforeEach.class)) {
                                    setup.setAccessible(true);
                                    setup.invoke(instance);
                                }
                            }
                        }

                        m.setAccessible(true);
                        m.invoke(instance);
                        passed++;
                        System.out.println("  PASS: " + testName);
                    } catch (Throwable t) {
                        failed++;
                        Throwable cause = t.getCause() != null ? t.getCause() : t;
                        failedNames.add(testName + ": " + cause.getMessage());
                        System.out.println("  FAIL: " + testName + " -> " + cause.getMessage());
                    }
                }
            }
        }

        System.out.println("\n========================================");
        System.out.println("TEST RESULTS: " + passed + " PASSED, " + failed + " FAILED");
        System.out.println("========================================");
        if (!failedNames.isEmpty()) {
            System.out.println("\nFailed tests:");
            failedNames.forEach(f -> System.out.println("  - " + f));
            System.exit(1);
        }
    }
}
