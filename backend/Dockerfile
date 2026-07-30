FROM amazoncorretto:21-al2023-headless

WORKDIR /app
COPY build/app.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]