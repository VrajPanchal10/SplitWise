@echo off
call .\mvnw.cmd test "-Dtest=AuthServiceTest,MultiCurrencyTest,SplitCalculationServiceTest,ReceiptParserServiceTest"
