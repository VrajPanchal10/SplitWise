# SplitWise

A modern, full-stack expense sharing and bill-splitting mobile application built with **React Native (Expo SDK 54)** and **Spring Boot 4.1 (Java 21)**, backed by **MongoDB Atlas**. SplitWise simplifies group finances, tracks 1-on-1 friend balances, processes receipts via an intelligent multi-stage OCR pipeline, and handles multi-currency expenses with universal INR debt settlement.

[![GitHub Repository](https://img.shields.io/badge/GitHub-VrajPanchal10%2FSplitWise-blue?logo=github)](https://github.com/VrajPanchal10/SplitWise.git)
[![Java Version](https://img.shields.io/badge/Java-21-orange?logo=openjdk)](https://openjdk.org/)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-4.1.0-brightgreen?logo=springboot)](https://spring.io/projects/spring-boot)
[![React Native](https://img.shields.io/badge/React%20Native-0.81.5-blue?logo=react)](https://reactnative.dev/)
[![Expo SDK](https://img.shields.io/badge/Expo%20SDK-54-black?logo=expo)](https://expo.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.2-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green?logo=mongodb)](https://www.mongodb.com/)

---

## Table of Contents

- [1. Project Overview and Purpose](#1-project-overview-and-purpose)
- [2. Key Features and Capabilities](#2-key-features-and-capabilities)
- [3. Technology Stack and Versions](#3-technology-stack-and-versions)
- [4. System Architecture](#4-system-architecture)
- [5. Repository and Directory Structure](#5-repository-and-directory-structure)
  - [Mobile Application (`splitwise-app`)](#mobile-application-splitwise-app)
  - [Backend Service (`splitwise-backend`)](#backend-service-splitwise-backend)
- [6. Database Architecture and Schemas](#6-database-architecture-and-schemas)
- [7. Multi-Currency and Universal INR Settlement](#7-multi-currency-and-universal-inr-settlement)
- [8. OCR and Intelligent Receipt Processing Pipeline](#8-ocr-and-intelligent-receipt-processing-pipeline)
- [9. Expense Splitting and Debt Simplification Engine](#9-expense-splitting-and-debt-simplification-engine)
- [10. Real-Time Balance Synchronization](#10-real-time-balance-synchronization)
- [11. API Architecture and Endpoint Reference](#11-api-architecture-and-endpoint-reference)
- [12. Local Development Prerequisites](#12-local-development-prerequisites)
- [13. Windows PowerShell Setup Guide](#13-windows-powershell-setup-guide)
- [14. Backend Configuration and Execution](#14-backend-configuration-and-execution)
- [15. Mobile App Configuration and Execution](#15-mobile-app-configuration-and-execution)
- [16. Environment Variables and Security](#16-environment-variables-and-security)
- [17. Automated Testing and Verification](#17-automated-testing-and-verification)
- [18. Production EAS Build (Android APK)](#18-production-eas-build-android-apk)
- [19. Known Limitations and Future Roadmap](#19-known-limitations-and-future-roadmap)
- [20. Repository Information](#20-repository-information)

---

## 1. Project Overview and Purpose

When groups of friends, flatmates, or travel companions split bills, standard tools often struggle with real-world complications: paper receipts with service charges and taxes, expenses in foreign currencies, floating-point rounding errors, and out-of-sync dashboards.

**SplitWise** solves these challenges by combining:
1. **Interactive Camera Cropping & Multi-Stage OCR**: Captures receipts, corrects orientation and boundaries, normalizes noisy characters, extracts line items with quantities, parses tax/service charges, and validates mathematical consistency.
2. **Universal INR Settlement with Foreign Currency Preservation**: Preserves the original foreign transaction amount and currency code (e.g., `$124.53 USD`) while locking in historical exchange rates at bill creation and executing all debt netting, balances, and settlements strictly in **INR**.
3. **Deterministic Debt Simplification**: A two-phase greedy resolution algorithm with exact-match sub-graph elimination that minimizes the total number of transactions needed to settle up.
4. **Instant Event-Driven Synchronization**: Native `DeviceEventEmitter` hooks propagate bill creations, edits, deletions, and settlements across Home, Friends, Groups, Insights, and Expense screens immediately without stale cache reloads.

---

## 2. Key Features and Capabilities

### Expense Creation & Management
- **Manual Expense Entry**: Single or group expenses with title, category, date, custom notes, and multi-currency support.
- **Receipt Scanning**: On-device interactive rectangle crop with pan/pinch handles, mapped accurately to image bitmap coordinates.
- **OCR Review & Reconciliation Screen**: Line-item extraction with editable item names, quantities, unit prices, tax, CGST/SGST, service charges, discounts, and round-offs. Flags mathematical mismatches between items and receipt grand totals.
- **Flexible Splitting Modes**:
  - *Equally*: Divisible among selected participants with exact integer-cent penny allocation to eliminate rounding discrepancies.
  - *Custom / Unequal Shares*: Per-user manual share entry with real-time total validation against the bill amount.
- **Expense Categorization**: Pre-configured categories (*Food & Dining, Groceries, Shopping, Travel, Transportation, Entertainment, Utilities, Rent, Healthcare, General*) for granular spending analytics.
- **Edit & Delete**: Full expense lifecycle support with recalculation of group debts and instant feed updates.

### Multi-Currency Engine
- **Supported Currencies**: `INR`, `USD`, `EUR`, `GBP`, `CAD`, `AUD`, `SGD`, `AED`, `JPY`.
- **Locked Historical Exchange Rates**: Persisted on each bill along with exchange rate timestamp.
- **Dual Display Model**: Expense cards show the original foreign currency amount alongside the calculated INR equivalent (`≈ ₹X INR`), while all debt calculations and balances operate exclusively in INR.

### Groups & Friend Balances
- **Group Management**: Create groups, add/remove members, view aggregate expenses, and track group net balances.
- **1-on-1 Friend Tracking**: Direct friend expense splits, aggregated balances combining group and personal debts, and detailed friendship history.
- **Friend Search**: Quick user discovery by email or full name.

### Debt Simplification & Settlements
- **Who Owes Whom**: Visual breakdown of minimized debts within groups.
- **Exact-Match & Greedy Minimization**: Simplifies N-way debts to the mathematical minimum number of transfers.
- **Settlement Recording**: Full or partial settlements recorded with date, recipient, and amount in INR.
- **Settlement Status Lifecycle**: Tracks `PENDING` vs `PAID` statuses with audit timestamps.

### Analytics, Insights & Activity Feed
- **Spending Trends**: Filterable by week, month, or all-time.
- **Category Breakdown**: Visual distribution of expenses by category with INR totals.
- **Member Analytics**: Top spenders, total group spending, and debt rankings.
- **Activity Feed**: Centralized stream of group creations, expense additions, edits, deletions, settlements, and profile updates.

---

## 3. Technology Stack and Versions

### Mobile Frontend (`splitwise-app`)
| Technology | Version | Purpose |
| :--- | :--- | :--- |
| **React Native** | `0.81.5` | Cross-platform native mobile framework |
| **React** | `19.1.0` | UI component library |
| **Expo SDK** | `~54.0.37` | Managed Expo runtime and tooling |
| **Expo Router** | `~6.0.24` | File-system-based routing navigation |
| **TypeScript** | `~5.9.2` | Static type checking and interface safety |
| **Axios** | `^1.19.0` | HTTP client with interceptors and retry policies |
| **AsyncStorage** | `2.2.0` | Persistent on-device token and preference storage |
| **Lucide React Native** | `^1.30.0` | Consistent vector iconography |
| **React Native Reanimated** | `~4.1.1` | High-performance UI transitions |
| **React Native Gesture Handler** | `~2.28.0` | Touch and gesture recognition for cropper |
| **Expo Image Manipulator** | `~14.0.8` | Client-side image cropping and resizing |
| **Expo Image Picker** | `~17.0.11` | Camera capture and gallery selection |

### Backend Service (`splitwise-backend`)
| Technology | Version | Purpose |
| :--- | :--- | :--- |
| **Java** | `21` (LTS) | Modern language runtime with pattern matching and records |
| **Spring Boot** | `4.1.0` | Microservice and enterprise application framework |
| **Spring Data MongoDB** | `4.1.0` | Object-document mapping for MongoDB Atlas |
| **Spring Security** | `4.1.0` | Stateless JWT authentication and endpoint protection |
| **JJWT (io.jsonwebtoken)** | `0.12.3` | JSON Web Token generation, signing, and parsing |
| **Tess4J (Tesseract OCR)** | `5.11.0` | Optical character recognition engine |
| **TwelveMonkeys ImageIO** | `3.10.1` | Resilient JPEG/PNG image decoders for mobile uploads |
| **Cloudinary HTTP44** | `1.39.0` | Cloud media storage for receipts and profile images |
| **Lombok** | `1.18.x` | Boilerplate reduction for models and DTOs |
| **Maven Wrapper** | `3.9.x` | Deterministic build tool and dependency management |

### Database & Infrastructure
- **MongoDB Atlas**: Managed cloud NoSQL database storing user, group, bill, settlement, and activity collections.
- **Expo Application Services (EAS)**: Cloud build pipeline configured for Android APK distribution.

---

## 4. System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SplitWise Mobile App (Expo / React Native)            │
│                                                                             │
│  ┌─────────────────────────┐  ┌───────────────────────┐  ┌───────────────┐  │
│  │   UI & Tabs (Router)    │  │  Crop & OCR Review    │  │  DeviceEvent  │  │
│  │  Home · Friends · Stats │  │  Pinch / Pan Modal    │  │  Emitter Bus  │  │
│  └────────────┬────────────┘  └───────────┬───────────┘  └───────▲───────┘  │
│               │                           │                      │          │
│               │                           │ (Multipart)          │ (Sync)   │
│               ▼                           ▼                      │          │
│  ┌───────────────────────────────────────────────────────────────┴───────┐  │
│  │                    Axios API Client Interceptor                       │  │
│  │   - Bearer JWT Injection       - 401 Session Invalidation             │  │
│  │   - Dynamic FormData Headers   - Automatic Network Retry (2x)         │  │
│  └────────────────────────────────────┬──────────────────────────────────┘  │
└───────────────────────────────────────┼─────────────────────────────────────┘
                                        │ HTTPS / HTTP (JSON / Multipart)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Spring Boot Backend (Java 21)                          │
│                                                                             │
│  ┌────────────────────────┐  ┌───────────────────────┐  ┌────────────────┐  │
│  │  Security Filter Chain │  │  Currency Conversion  │  │  Cloudinary    │  │
│  │  JwtAuthFilter         │  │  Locked Rate Engine   │  │  Media Storage │  │
│  └────────────┬───────────┘  └───────────┬───────────┘  └────────┬───────┘  │
│               │                          │                       │          │
│               ▼                          ▼                       │          │
│  ┌─────────────────────────────────────────────────────────┐     │          │
│  │                     REST Controllers                    │     │          │
│  │  AuthController · BillController · GroupController      │     │          │
│  │  SettlementController · UserController · OcrController  │     │          │
│  └────────────┬──────────────────────────┬─────────────────┘     │          │
│               │                          │                       │          │
│               ▼                          ▼                       │          │
│  ┌────────────────────────┐  ┌───────────────────────┐           │          │
│  │  ReceiptParserService  │  │ SplitCalculationSvc   │           │          │
│  │  - Tess4J OCR Engine   │  │ - Integer-Cent Split  │           │          │
│  │  - 7-Stage Normalizer  │  │ - Debt Simplification │           │          │
│  └────────────────────────┘  └───────────┬───────────┘           │          │
│                                          │                       │          │
│                                          ▼                       │          │
│                             ┌────────────────────────┐           │          │
│                             │   Spring Data Repos    │           │          │
│                             └────────────┬───────────┘           │          │
└──────────────────────────────────────────┼───────────────────────┼──────────┘
                                           │                       │
                                           ▼                       ▼
                            ┌────────────────────────┐ ┌──────────────────────┐
                            │     MongoDB Atlas      │ │ Cloudinary Media CDN │
                            │ (Bills, Users, Groups) │ │  (Receipt Images)    │
                            └────────────────────────┘ └──────────────────────┘
```

---

## 5. Repository and Directory Structure

### Mobile Application (`splitwise-app`)

```text
splitwise-app/
├── app/                                # Expo Router file-system routes
│   ├── (auth)/                         # Authentication flows
│   │   ├── _layout.tsx
│   │   ├── login.tsx                   # User login screen
│   │   ├── onboarding.tsx              # Welcome & feature carousel
│   │   └── signup.tsx                  # Account registration
│   ├── (tabs)/                         # Bottom-tab primary destinations
│   │   ├── _layout.tsx                 # Tab navigation config & icons
│   │   ├── groups.tsx                  # Friends & group balance list
│   │   ├── index.tsx                   # Home dashboard & overall balance
│   │   ├── insights.tsx                # Spending trends, categories & analytics
│   │   └── profile.tsx                 # User profile, QR code & settings
│   ├── bill/
│   │   └── [id].tsx                    # Detailed expense breakdown & edit
│   ├── friend/
│   │   └── [id].tsx                    # 1-on-1 friendship ledger & settlements
│   ├── group/
│   │   └── [id].tsx                    # Group expenses, balances & settlements
│   ├── _layout.tsx                     # Root app layout & AuthProvider wrapper
│   ├── add-bill.tsx                    # Expense creation entry point
│   ├── add-group.tsx                   # Create group & invite members
│   ├── edit-profile.tsx                # Name, photo, default currency settings
│   ├── manual-entry.tsx                # Manual bill creation & custom split
│   ├── ocr-review.tsx                  # OCR review, currency selector & validation
│   ├── qr-code.tsx                     # Payment UPI/QR code viewer & upload
│   ├── scan-bill.tsx                   # Camera & gallery receipt upload trigger
│   └── split-summary.tsx               # Review shares before saving
├── assets/images/                      # App icons, splash, and brand images
├── components/                         # Reusable UI components
│   ├── CurrencyPickerModal.tsx         # Supported currencies picker modal
│   ├── ReceiptCropperModal.tsx         # Interactive pan/pinch crop overlay
│   └── ZigzagEdge.tsx                  # Receipt-style serrated edge styling
├── constants/
│   ├── categories.ts                   # Expense categories, icons, and colors
│   ├── config.ts                       # Dynamic API base URL configuration
│   ├── currencies.ts                   # Currency metadata, flags, symbols, rates
│   └── theme.ts                        # Design system colors, fonts, spacing
├── context/
│   ├── AuthContext.tsx                 # JWT session & active user state
│   └── BillCreationContext.tsx         # Multi-screen bill wizard state
├── scripts/
│   └── test-crop-math.js               # Cropper coordinate transformation tests
├── services/
│   └── apiClient.ts                    # Axios client, JWT interceptor & retry logic
├── utils/
│   ├── cropUtils.ts                    # Viewport-to-bitmap crop math functions
│   ├── dateUtils.ts                    # Asia/Kolkata timezone & relative formatting
│   └── splitCalculator.ts              # Client-side share validation helpers
├── app.json                            # Expo application manifest
├── eas.json                            # EAS build configuration (APK & Preview)
├── package.json                        # Dependencies & scripts
├── start-lan.js                        # Auto-detects IPv4 & starts Expo with LAN IP
└── tsconfig.json                       # Strict TypeScript configuration
```

### Backend Service (`splitwise-backend`)

```text
splitwise-backend/
├── src/
│   ├── main/
│   │   ├── java/com/splitwise/splitwisebackend/
│   │   │   ├── config/                 # Security, CORS, Mongo, Cloudinary configs
│   │   │   │   ├── CloudinaryConfig.java
│   │   │   │   ├── CorsConfig.java
│   │   │   │   ├── MongoConfig.java
│   │   │   │   └── SecurityConfig.java
│   │   │   ├── controller/             # REST API Controllers
│   │   │   │   ├── ActivityController.java
│   │   │   │   ├── AuthController.java
│   │   │   │   ├── BillController.java
│   │   │   │   ├── CurrencyController.java
│   │   │   │   ├── GroupController.java
│   │   │   │   ├── OcrController.java
│   │   │   │   ├── SettlementController.java
│   │   │   │   ├── UploadController.java
│   │   │   │   └── UserController.java
│   │   │   ├── dto/                    # Request and response payloads
│   │   │   │   ├── BillBreakdownResponse.java
│   │   │   │   ├── CreateBillRequest.java
│   │   │   │   ├── ParticipantShare.java
│   │   │   │   ├── ReceiptParseResult.java
│   │   │   │   ├── RecordSettlementRequest.java
│   │   │   │   └── Settlement.java
│   │   │   ├── exception/              # Centralized error handling
│   │   │   │   ├── ApiException.java
│   │   │   │   └── GlobalExceptionHandler.java
│   │   │   ├── model/                  # MongoDB Document entities
│   │   │   │   ├── Activity.java
│   │   │   │   ├── Bill.java
│   │   │   │   ├── BillItem.java
│   │   │   │   ├── Group.java
│   │   │   │   ├── SettlementRecord.java
│   │   │   │   └── User.java
│   │   │   ├── repository/             # Spring Data Mongo Repositories
│   │   │   │   ├── ActivityRepository.java
│   │   │   │   ├── BillRepository.java
│   │   │   │   ├── GroupRepository.java
│   │   │   │   ├── SettlementRecordRepository.java
│   │   │   │   └── UserRepository.java
│   │   │   ├── security/               # JWT authentication implementation
│   │   │   │   ├── CustomUserDetailsService.java
│   │   │   │   ├── JwtAuthFilter.java
│   │   │   │   ├── JwtUtil.java
│   │   │   │   └── PasswordConfig.java
│   │   │   ├── service/                # Core business logic
│   │   │   │   ├── ActivityService.java
│   │   │   │   ├── AuthService.java
│   │   │   │   ├── BillService.java
│   │   │   │   ├── CloudinaryService.java
│   │   │   │   ├── CurrencyConversionService.java
│   │   │   │   ├── GroupService.java
│   │   │   │   ├── OcrService.java
│   │   │   │   ├── ReceiptParserService.java
│   │   │   │   ├── SplitCalculationService.java
│   │   │   │   └── UserService.java
│   │   │   └── SplitwiseBackendApplication.java
│   │   └── resources/
│   │       ├── application.properties          # Production properties (env placeholders)
│   │       └── application.properties.example  # Reference template for local setup
│   └── test/
│       └── java/com/splitwise/splitwisebackend/service/
│           ├── MultiCurrencyTest.java          # 13 Multi-currency conversion tests
│           ├── MultiCurrencyTestRunner.java    # Standalone execution harness
│           ├── OcrTestRunner.java              # Standalone OCR execution harness
│           ├── ReceiptParserServiceTest.java   # 48 OCR pipeline regression tests
│           └── SplitCalculationServiceTest.java# 26 Split & debt simplification tests
├── tessdata/                           # Tesseract traineddata language files
├── pom.xml                             # Maven POM with Java 21 & dependencies
├── run_tests.cmd                       # PowerShell/CMD test execution script
└── Dockerfile                          # Containerization manifest
```

---

## 6. Database Architecture and Schemas

SplitWise uses MongoDB Atlas with five primary collections and UTC ISO 8601 timestamps:

### Collections Overview

```
┌─────────────────┐       ┌─────────────────┐
│      users      │◄──────┤     groups      │
│                 │1    N │  - memberIds[]  │
└────────┬────────┘       └────────┬────────┘
         │1                        │1
         │                         │
         │N                        │N
┌────────┴────────┐       ┌────────┴────────┐
│      bills      │       │   settlements   │
│ - currency      │       │ - amount (INR)  │
│ - exchangeRate  │       │ - status        │
│ - items[]       │       │ - fromUserId    │
│ - customShares  │       │ - toUserId      │
└─────────────────┘       └─────────────────┘
```

#### 1. `users` Collection
| Field | Type | Description |
| :--- | :--- | :--- |
| `_id` | String | Unique user ID |
| `fullName` | String | User's full name |
| `email` | String | Unique indexed email |
| `password` | String | BCrypt-hashed password |
| `profilePictureUrl` | String | Cloudinary media URL (optional) |
| `paymentQrUrl` | String | Cloudinary UPI/payment QR image URL (optional) |
| `defaultCurrency` | String | Preferred currency (defaults to `"INR"`) |
| `createdAt` | UTC Date | Account creation timestamp |

#### 2. `groups` Collection
| Field | Type | Description |
| :--- | :--- | :--- |
| `_id` | String | Unique group ID |
| `name` | String | Group display name |
| `memberIds` | List<String> | References to `users._id` |
| `createdBy` | String | User ID of group creator |
| `defaultCurrency` | String | Currency tag for group (defaults to `"INR"`) |
| `createdAt` | UTC Date | Group creation timestamp |
| *`userBalance`* | Double | `@Transient` computed net balance for the caller |

#### 3. `bills` Collection
| Field | Type | Description |
| :--- | :--- | :--- |
| `_id` | String | Unique bill ID |
| `title` | String | Bill title or merchant name |
| `totalAmount` | Double | Original total in `currency` denomination |
| `currency` | String | ISO 3-letter currency code (e.g., `"USD"`, `"INR"`) |
| `baseCurrency` | String | Universal settlement currency (always `"INR"`) |
| `exchangeRate` | Double | Exchange rate factor locked at bill creation time |
| `exchangeRateDate`| UTC Date | Timestamp when exchange rate was recorded |
| `convertedAmount`| Double | Total amount converted into INR |
| `category` | String | Expense category (e.g., `"Food"`, `"Travel"`) |
| `groupId` | String | Group ID (null for 1-on-1 friend bills) |
| `paidBy` | String | User ID who covered the upfront payment |
| `items` | List<BillItem> | Array of items with individual prices and shares |
| `receiptUrl` | String | Cloudinary image URL of scanned receipt |
| `createdAt` | UTC Date | Bill creation timestamp in UTC |

#### 4. `settlements` Collection
| Field | Type | Description |
| :--- | :--- | :--- |
| `_id` | String | Unique settlement ID |
| `groupId` | String | Group ID (null for non-group settlements) |
| `fromUserId` | String | Debtor user ID |
| `toUserId` | String | Creditor user ID |
| `amount` | Double | Settlement amount strictly in **INR** |
| `currency` | String | Currency code (always `"INR"`) |
| `status` | String | `PENDING` or `PAID` |
| `createdAt` | UTC Date | Timestamp settlement was recorded |
| `paidAt` | UTC Date | Timestamp settlement was marked paid |

#### 5. `activities` Collection
| Field | Type | Description |
| :--- | :--- | :--- |
| `_id` | String | Unique activity ID |
| `userId` | String | Recipient user ID for the activity feed |
| `actorUserId` | String | User ID who performed the action |
| `type` | String | `EXPENSE_ADDED`, `EXPENSE_SETTLED`, `GROUP_CREATED`, etc. |
| `description` | String | Human-readable activity narrative |
| `relatedGroupId` | String | Associated group ID |
| `relatedBillId` | String | Associated bill ID |
| `amount` | Double | Associated transaction amount |
| `createdAt` | UTC Date | Activity generation timestamp |

---

## 7. Multi-Currency and Universal INR Settlement

SplitWise establishes **INR (₹)** as the universal base currency for all debt simplifications and settlements while honoring the currency in which an expense actually occurred.

### Supported Currencies & Base Rates
The system supports 9 currencies with reference conversion rates:
- **INR** (Indian Rupee) — Universal Base Currency (`₹`)
- **USD** (US Dollar) — `$`, Reference: `1 USD = 86.50 INR`
- **EUR** (Euro) — `€`
- **GBP** (British Pound) — `£`
- **CAD** (Canadian Dollar) — `C$`
- **AUD** (Australian Dollar) — `A$`
- **SGD** (Singapore Dollar) — `S$`
- **AED** (UAE Dirham) — `AED `
- **JPY** (Japanese Yen) — `¥`

### Expense Creation Workflow (Example)
1. A user creates an expense for **$124.53 USD** ("The Tack Room" dinner).
2. At creation time, the backend `CurrencyConversionService` fetches/locks the exchange rate (`1 USD = 90.00 INR`).
3. Converted INR amount is calculated:
   $$\$124.53 \times 90.00 = ₹11,207.70\text{ INR}$$
4. The bill stores:
   - `currency = "USD"`
   - `totalAmount = 124.53`
   - `baseCurrency = "INR"`
   - `exchangeRate = 90.0`
   - `convertedAmount = 11207.70`
5. Four equal participants share the expense. Each participant's share is calculated strictly on the converted INR amount:
   $$\frac{₹11,207.70}{4} = ₹2,801.925 \implies \text{allocated via integer cents (₹2801.93 / ₹2801.92)}$$
6. **Result**: No USD debt is created. All debts, balances, and settlement options operate in INR.

### Display Rules Across the Application
- **Original Expense Screens**: Displays the original denomination alongside the converted amount:
  > **The Tack Room**  
  > `$124.53 USD`  
  > `≈ ₹11,207.70 INR (1 USD = 90 INR)`
- **Home, Groups & Friends Balances**: Formatted exclusively in INR (`+₹2,801.93` or `-₹2,801.92`).
- **Settlement & Settle Up Modals**: Prefixed with `₹` and settled strictly in INR.
- **Insights & Spending Analytics**: Aggregated purely in INR. Foreign currencies are never summed directly without conversion.

---

## 8. OCR and Intelligent Receipt Processing Pipeline

The receipt processing system extracts structured line items from raw receipt photos through an image-processing and text-parsing pipeline:

```text
[Mobile Camera / Gallery]
           │
           ▼
[Interactive Cropper Modal] ──(Pan / Pinch Handles, Clamped Coordinates)
           │
           ▼
[Expo Image Manipulator] ────(High-Precision Crop & Resize)
           │
           ▼ (Multipart Upload)
[Spring Boot /api/ocr/scan]
           │
           ├─► [Cloudinary] ──(Stores receipt image & returns HTTPS URL)
           │
           └─► [TwelveMonkeys + Tess4J Engine]
                     │
                     ▼
           [7-Stage ReceiptParserService]
             1. Character & Currency Normalization
             2. Header & Noise Filtering
             3. Multi-Format Line-Item Extraction
             4. Financial Line Detection (Tax, CGST/SGST, Tip, Service Charge)
             5. Priority Grand Total Selection
             6. Numeric Cross-Validation
             7. Confidence Scoring
                     │
                     ▼
           [OCR Review Screen (Mobile)]
             - Visual verification of items & totals
             - Currency selection pill (USD, EUR, INR, etc.)
             - Discrepancy warning banner
                     │
                     ▼
           [Manual Entry / Split Wizard]
```

### 7 Stages of `ReceiptParserService`
1. **Normalization**: Removes currency symbols (`$`, `₹`, `Rs.`), cleans OCR noise, and handles OCR character confusions (e.g., `O` $\leftrightarrow$ `0`, `l` $\leftrightarrow$ `1`, `S` $\leftrightarrow$ `5`) strictly in numeric contexts.
2. **Metadata & Header Filtering**: Detects business/merchant titles while discarding column header rows (`ITEM`, `QTY`, `RATE`, `AMOUNT`).
3. **Multi-Format Line Item Parsing**: Recognizes standard item structures:
   - `Item Description <Qty> <Unit Price> <Total>` (e.g., `2 Burger @ 12.00 24.00`)
   - `Item Description <Qty> <Total>`
   - `Item Description <Total>`
4. **Financial Section Parsing**: Extracts Subtotal, CGST, SGST, Sales Tax, Service Charges, Tips, Discounts, and Round-Offs.
5. **Grand Total Selection**: Evaluates candidate total lines using a strict hierarchy: `GRAND TOTAL` > `AMOUNT PAYABLE` > `NET PAYABLE` > `TOTAL`. Never mistakes the subtotal for the final total when taxes or fees exist.
6. **Cross-Validation**: Verifies if $\sum (\text{items}) + \text{taxes} + \text{charges} - \text{discounts} = \text{total}$. Flags warnings to the user if a mismatch exists.
7. **Confidence Scoring**: Assigns an overall parse confidence score based on arithmetic harmony and field completeness.

---

## 9. Expense Splitting and Debt Simplification Engine

### Integer-Cent Penny Allocation
When an amount cannot be evenly divided (e.g., splitting ₹100.00 among 3 participants):
- Total cents: $10000$ cents.
- Base share: $\lfloor 10000 / 3 \rfloor = 3333$ cents (₹33.33).
- Remainder: $10000 \pmod 3 = 1$ cent.
- Split: Participant 1 pays ₹33.34; Participants 2 and 3 pay ₹33.33.
- $\sum (\text{shares})$ matches the total amount to the penny ($33.34 + 33.33 + 33.33 = 100.00$), preventing floating-point leakages.

### Debt Simplification Algorithm (`SplitCalculationService`)
Within any group, cyclic and multi-hop debts are reduced using a two-phase optimization algorithm:

```text
Unsimplified Debts:               Simplified (Optimal):
 Alice ── owes ₹500 ──► Bob        Alice ── owes ₹500 ──► Charlie
   ▲                      │
   │                      │ owes ₹500
   │                      ▼
   └────── Charlie ◄──────┘
```

1. **Net Balance Calculation**: For each participant $i$:
   $$\text{NetBalance}_i = \sum (\text{Paid by } i) - \sum (\text{Owed by } i) - \sum (\text{Settled to } i) + \sum (\text{Settled from } i)$$
2. **Partitioning**: Participants are divided into **Creditors** ($\text{Net} > 0$) and **Debtors** ($\text{Net} < 0$).
3. **Phase 1: Exact-Match Elimination**:
   - Searches for pairs where $\text{Creditor Cents} == \text{Debtor Cents}$.
   - Resolves both in a single direct transaction, immediately removing 2 nodes from the graph.
4. **Phase 2: Greedy Resolution**:
   - Takes the largest remaining debtor and pairs them with the largest remaining creditor.
   - Settles $\min(|\text{Debtor}|, \text{Creditor})$.
   - Repeats until all balances are zeroed out.

---

## 10. Real-Time Balance Synchronization

To eliminate stale balances and manual app refreshes, SplitWise uses a reactive event bus pattern powered by React Native's `DeviceEventEmitter`:

```text
┌───────────────────────┐
│ Expense Mutation      │
│ - Bill Created        │
│ - Bill Updated        │
│ - Bill Deleted        │
│ - Settlement Recorded │
│ - Group Added/Deleted │
└──────────┬────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│                 DeviceEventEmitter.emit(...)                │
└──────┬─────────────┬─────────────┬─────────────┬────────────┘
       │             │             │             │
       ▼             ▼             ▼             ▼
┌─────────────┐┌─────────────┐┌─────────────┐┌─────────────┐
│ HomeScreen  ││ FriendsTab  ││ GroupScreen ││ Insights    │
│ (index.tsx) ││(groups.tsx) ││ (group/[id])││(insights.ts)│
│             ││             ││             ││             │
│ Refetches   ││ Refetches   ││ Updates     ││ Recalculates│
│ /groups and ││ /friends &  ││ local bills ││ trends and  │
│ /balances   ││ /balances   ││ & balances  ││ analytics   │
└─────────────┘└─────────────┘└─────────────┘└─────────────┘
```

### Handled Events
- `bill:created`: Emitted when an expense is successfully saved.
- `bill:updated`: Emitted when an existing expense is modified.
- `bill:deleted`: Emitted when an expense is deleted; removes the bill and triggers balance recomputation.
- `settlement:recorded`: Emitted when a payment is recorded between two users.
- `group:created` / `group:deleted`: Emitted on group creation, deletion, or member departure.

---

## 11. API Architecture and Endpoint Reference

All endpoints (except `/api/auth/**`) require a valid JWT token passed in the `Authorization: Bearer <token>` header.

### Authentication (`/api/auth`)
| Method | Endpoint | Request Body | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/signup` | `{ fullName, email, password }` | Register a new user |
| `POST` | `/api/auth/login` | `{ email, password }` | Authenticate and obtain JWT token |

### Users (`/api/users`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/users/me` | Fetch authenticated user profile |
| `GET` | `/api/users/{id}` | Fetch user details by ID |
| `PUT` | `/api/users/me` | Update name, email, or profile metadata |
| `PUT` | `/api/users/me/currency` | Update user default currency |
| `PUT` | `/api/users/me/profile-picture` | Update profile image URL |
| `PUT` | `/api/users/me/payment-qr` | Update payment QR code image URL |
| `GET` | `/api/users/me/stats` | Retrieve user total expenses and settlement statistics |
| `GET` | `/api/users/search?q={query}` | Search users by name or email |
| `GET` | `/api/users/me/friends` | Get list of distinct friends |
| `GET` | `/api/users/me/friend-balances` | Get aggregated 1-on-1 net balances in INR |

### Groups (`/api/groups`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/groups` | Create group `{ name, memberIds, defaultCurrency }` |
| `GET` | `/api/groups` | Get user groups with pre-computed `userBalance` in INR |
| `GET` | `/api/groups/{id}` | Get group details and current user balance |
| `POST` | `/api/groups/{id}/members` | Add user IDs to group |
| `DELETE`| `/api/groups/{id}/members/{userId}` | Remove a member or leave group |
| `GET` | `/api/groups/{id}/members` | List member profiles in group |
| `DELETE`| `/api/groups/{id}` | Delete group and associated dependencies |

### Bills & Expenses (`/api/bills`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/bills` | Create expense with currency, items, and shares |
| `GET` | `/api/bills/group/{groupId}` | Get all expenses belonging to a group |
| `GET` | `/api/bills/with-friend/{friendId}` | Get shared expenses between current user and friend |
| `GET` | `/api/bills/{id}` | Get individual expense details |
| `GET` | `/api/bills/{id}/breakdown` | Get itemized participant breakdown for a bill |
| `PUT` | `/api/bills/{id}` | Update existing bill |
| `DELETE`| `/api/bills/{id}` | Delete bill (creator only) |
| `GET` | `/api/bills/group/{groupId}/settlements`| Get simplified settlements for a group |
| `GET` | `/api/bills/mine` | Get all personal and shared expenses for analytics |

### Settlements (`/api/settlements`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/settlements` | Record full/partial settlement `{ toUserId, amount, groupId }` |
| `GET` | `/api/settlements/group/{groupId}` | Get settlement history for a group |
| `GET` | `/api/settlements/friend/{friendId}` | Get settlement history with a friend |
| `PUT` | `/api/settlements/{id}/mark-paid` | Mark settlement status as `PAID` |
| `POST` | `/api/settlements/settle-with-friend/{friendId}` | Quick settle-up with a friend |

### OCR & Uploads (`/api/ocr`, `/api/upload`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/ocr/scan` | Upload receipt image (`multipart/form-data`) for OCR parsing |
| `POST` | `/api/upload/image` | Upload image to Cloudinary and retrieve HTTPS URL |

### Currencies (`/api/currencies`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/currencies` | List all supported currencies and symbols |
| `GET` | `/api/currencies/rate?from=USD&to=INR` | Get exchange rate factor between two currencies |

### Activities (`/api/activities`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/activities/me` | Get recent activity log for the current user |

---

## 12. Local Development Prerequisites

Ensure the following tools are installed on your workstation:

1. **Java Development Kit (JDK) 21**:
   - Verify with: `java -version`
2. **Node.js (v20.x or v22.x LTS)** & **npm**:
   - Verify with: `node -v` and `npm -v`
3. **MongoDB**:
   - MongoDB Atlas connection URI or local MongoDB instance (`mongodb://localhost:27017/splitwise_db`).
4. **Git**:
   - Verify with: `git --version`
5. **Mobile Device or Emulator**:
   - Physical Android/iOS phone with the **Expo Go** app installed.
   - Or Android Studio Emulator / iOS Simulator.
6. **Cloudinary Account (Optional for receipt image hosting)**:
   - Free account credentials for image uploads.

---

## 13. Windows PowerShell Setup Guide

Clone the repository:

```powershell
# Clone the repository
git clone https://github.com/VrajPanchal10/SplitWise.git
cd SplitWise
```

---

## 14. Backend Configuration and Execution

### Step 1: Configure Environment Variables
Set your environment variables in PowerShell before launching the Spring Boot backend:

```powershell
# Navigate to backend directory
cd D:\AndroidProjects\SplitWise\splitwise-backend

# Set MongoDB Atlas URI
$env:SPRING_DATA_MONGODB_URI="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/splitwise_db?retryWrites=true&w=majority"
$env:SPRING_DATA_MONGODB_DATABASE="splitwise_db"

# Set JWT Secret (minimum 32 characters)
$env:JWT_SECRET="YourVeryLongAndSecureRandomJwtSecretKeyHere32CharsMin"
$env:JWT_EXPIRATION="86400000"

# Optional: Cloudinary configuration for receipt hosting
$env:CLOUDINARY_CLOUD_NAME="your_cloud_name"
$env:CLOUDINARY_API_KEY="your_api_key"
$env:CLOUDINARY_API_SECRET="your_api_secret"

# Server Port (defaults to 8080)
$env:SERVER_PORT="8080"
```

> **Alternatively**: Copy `src/main/resources/application.properties.example` to `src/main/resources/application-local.properties`, fill in your secrets, and run with `-Dspring-boot.run.profiles=local`.

### Step 2: Build and Run Backend
Using the Maven wrapper:

```powershell
# Clean and compile
.\mvnw.cmd clean compile

# Start Spring Boot application
.\mvnw.cmd spring-boot:run
```

The server starts on `http://localhost:8080` (or your machine's LAN IP `http://<YOUR_LAN_IP>:8080`).

---

## 15. Mobile App Configuration and Execution

### Step 1: Install Dependencies
```powershell
cd D:\AndroidProjects\SplitWise\splitwise-app
npm install
```

### Step 2: Launch via LAN Mode (Recommended for Physical Devices)
The app includes a custom LAN launcher (`start-lan.js`) that automatically detects your active Wi-Fi IPv4 address, binds `EXPO_PUBLIC_API_URL`, and starts Expo:

```powershell
npm run start:lan
```

You will see:
```text
========================================
 SplitWise LAN Development
========================================
 Laptop IPv4 : 192.168.1.100
 API URL     : http://192.168.1.100:8080/api
========================================
```

### Step 3: Connect Your Device
- Open **Expo Go** on your Android or iOS device (ensure your phone is connected to the same Wi-Fi network).
- Scan the displayed QR code.

---

## 16. Environment Variables and Security

| Variable Name | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `SPRING_DATA_MONGODB_URI` | **Yes** | — | MongoDB Atlas connection string |
| `SPRING_DATA_MONGODB_DATABASE` | No | `splitwise_db` | MongoDB database name |
| `JWT_SECRET` | **Yes** | — | Secret key for signing JWT tokens ($\ge 32$ chars) |
| `JWT_EXPIRATION` | No | `86400000` | Token validity in milliseconds (24 hours) |
| `SERVER_PORT` / `PORT` | No | `8080` | Backend HTTP listening port |
| `CLOUDINARY_CLOUD_NAME` | No | — | Cloudinary cloud account name |
| `CLOUDINARY_API_KEY` | No | — | Cloudinary public API key |
| `CLOUDINARY_API_SECRET` | No | — | Cloudinary API secret |
| `CLOUDINARY_FOLDER` | No | `SplitWise` | Folder name for stored images |
| `TESSERACT_DATAPATH` | No | `tessdata` | Path to Tesseract traineddata directory |
| `EXPO_PUBLIC_API_URL` | No | Auto-detected | Frontend base API URL (`http://<IP>:8080/api`) |

> [!CAUTION]
> **Security Reminder**: Never commit real database credentials, JWT secrets, or Cloudinary API keys to source control. Always keep them in uncommitted environment variables or `application-local.properties` (which is excluded by `.gitignore`).

---

## 17. Automated Testing and Verification

The repository includes test suites covering multi-currency math, OCR extraction, debt simplification, and type safety.

### 1. Backend Service & Multi-Currency Tests (39 Tests)
Executes `MultiCurrencyTest` and `SplitCalculationServiceTest`:

```powershell
cd D:\AndroidProjects\SplitWise\splitwise-backend
.\run_tests.cmd
```

```text
==================================================
Running MultiCurrencyTest...
  PASS: Test 1: INR-only expense preserves exact single-currency behavior
  PASS: Test 2: USD-only expense with USD group
  PASS: Test 3: USD expense displayed and converted in INR with historical rate
  PASS: Test 4: Splitting foreign currency with indivisible remainder preserves pennies
  PASS: Test 5: Balance aggregation across multi-currency expenses maintains zero-sum
  PASS: Test 7: Currency conversion rates and symbols validation
  PASS: Test 8: GBP expense converted to INR with deterministic precision
  PASS: Test 9: EUR expense converted to INR
  PASS: Test 10: The Tack Room fixture ($124.53 USD @ 90.0) split 4 ways into exact INR shares
  PASS: Test 11: Partial and full INR settlements correctly update net balances
  PASS: Test 12: Historical expense display uses locked rate
  PASS: Test 13: Multiple expenses across USD, EUR, and INR between same participants
Running SplitCalculationServiceTest...
  PASS: 26 split calculation & simplification tests passed
==================================================
All Service Test Results: 39 passed, 0 failed.
==================================================
```

### 2. Backend OCR Pipeline Regression Tests (48 Tests)
Executes `ReceiptParserServiceTest` covering The Tack Room fixture, CGST/SGST, discounts, and currency noise:

```powershell
cd D:\AndroidProjects\SplitWise\splitwise-backend
java "@run_ocr_tests_args.txt"
```

```text
Running ReceiptParserServiceTest...
  PASS: Part2AcceptanceSuite (5 tests)
  PASS: TheTackRoomRegressionSuite (10 tests)
  PASS: ParseMoney, EdgeCases, Normalization, ConfidenceScoring (33 tests)
========================================
TEST RESULTS: 48 PASSED, 0 FAILED
========================================
```

### 3. Frontend Static Type Check
Verifies TypeScript compilation with 0 errors across all screens and components:

```powershell
cd D:\AndroidProjects\SplitWise\splitwise-app
npx tsc --noEmit
```

### 4. Image Cropper Mathematical Verification
Verifies screen-to-bitmap coordinate mapping for tall, wide, and rotated receipts:

```powershell
cd D:\AndroidProjects\SplitWise\splitwise-app
node scripts/test-crop-math.js
```

---

## 18. Production EAS Build (Android APK)

The project includes an `eas.json` configuration configured for standalone APK builds:

### Prerequisites
Install EAS CLI globally and log in:
```powershell
npm install -g eas-cli
eas login
```

### Build Android Standalone APK
To generate a distributable `.apk` file for testing on physical Android devices:

```powershell
cd D:\AndroidProjects\SplitWise\splitwise-app

# Build APK using the production profile
eas build --platform android --profile production
```

Configuration in `eas.json`:
```json
{
  "build": {
    "production": {
      "autoIncrement": true,
      "environment": "production",
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

---

## 19. Known Limitations and Future Roadmap

### Current Limitations
- **Offline Mode**: The mobile application requires an active network connection to the Spring Boot backend; offline mutations are not queued locally.
- **Reference Exchange Rates**: Exchange rates are locked at creation using built-in reference rates and can be extended to live third-party financial exchange rate APIs.
- **Tesseract OCR Language**: Pre-packaged trained data focuses on English characters; non-Latin script receipts require adding respective language files to `tessdata/`.

### Planned Future Improvements
- [ ] Push notifications for new expense additions and settlement reminders.
- [ ] Recurring expense scheduling (e.g., monthly rent, recurring subscriptions).
- [ ] Direct in-app UPI payment integration via payment intent deep links.
- [ ] Multi-receipt batch scanning and automated PDF statement extraction.
- [ ] Export group ledger to CSV and PDF formats.

---

## 20. Repository Information

- **Repository**: [https://github.com/VrajPanchal10/SplitWise.git](https://github.com/VrajPanchal10/SplitWise.git)
- **Primary Branch**: `main`
- **License**: MIT (or project default)

---
*Built with ❤️ for hassle-free expense sharing.*
