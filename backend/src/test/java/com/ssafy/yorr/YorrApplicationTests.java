package com.ssafy.yorr;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest
@Testcontainers
class YorrApplicationTests {

	@Container
	private static final GenericContainer<?> MYSQL =
			new GenericContainer<>(DockerImageName.parse("mysql:8.0"))
					.withEnv("MYSQL_DATABASE", "yorr")
					.withEnv("MYSQL_ROOT_PASSWORD", "test")
					.withExposedPorts(3306);

	@Container
	private static final GenericContainer<?> REDIS =
			new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine"))
					.withExposedPorts(6379);

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		registry.add("spring.datasource.url", () ->
				"jdbc:mysql://" + MYSQL.getHost() + ":" + MYSQL.getFirstMappedPort() + "/yorr");
		registry.add("spring.datasource.username", () -> "root");
		registry.add("spring.datasource.password", () -> "test");
		registry.add("spring.data.redis.host", REDIS::getHost);
		registry.add("spring.data.redis.port", REDIS::getFirstMappedPort);
		registry.add("spring.docker.compose.enabled", () -> "false");
	}

	@Test
	void contextLoads() {
	}

}
