@echo off
call .\mvnw.cmd test "-Dtest=MultiCurrencyTest,SplitCalculationServiceTest,ReceiptParserServiceTest"
