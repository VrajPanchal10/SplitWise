FROM eclipse-temurin:21-jdk-alpine AS build

WORKDIR /app

COPY mvnw .
COPY .mvn .mvn
COPY pom.xml .

RUN chmod +x mvnw
RUN ./mvnw dependency:go-offline -B

COPY src src
COPY tessdata tessdata

RUN ./mvnw clean package -DskipTests


FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

# Install native OCR engine and its image-processing dependency
RUN apk add --no-cache tesseract-ocr leptonica

COPY --from=build /app/target/splitwise-backend-0.0.1-SNAPSHOT.jar app.jar
COPY --from=build /app/tessdata ./tessdata

EXPOSE 8080

ENTRYPOINT ["java", "-Djna.library.path=/usr/lib:/lib", "-jar", "app.jar"]