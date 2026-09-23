# SplitWise

SplitWise is a full-stack mobile bill-splitting application developed as a Mobile Application Development (MAD) project.

The application helps users create groups, add friends, record shared expenses, split bills, track balances, and settle debts.

## Features

- User registration and login
- JWT-based authentication
- Create and manage groups
- Add friends and search users
- Create shared expenses
- Manual expense splitting
- Receipt scanning using OCR
- Image upload
- Group balance tracking
- Expense and activity history
- Settlement management
- Debt simplification

## Technology Stack

### Mobile Application

- React Native
- Expo
- TypeScript
- React Navigation

### Backend

- Java 21
- Spring Boot
- Spring Security
- JWT
- Maven

### Database

- MongoDB

### Additional Technologies

- Tesseract OCR
- Tess4J
- Cloudinary
- REST APIs

## Project Structure

```text
SplitWise/
├── splitwise-app/
│   ├── app/
│   ├── components/
│   ├── constants/
│   └── package.json
│
├── splitwise-backend/
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/com/splitwise/splitwisebackend/
│   │   │   └── resources/
│   │   └── test/
│   ├── tessdata/
│   ├── pom.xml
│   └── Dockerfile
│
└── README.md
