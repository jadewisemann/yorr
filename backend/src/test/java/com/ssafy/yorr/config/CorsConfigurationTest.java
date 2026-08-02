package com.ssafy.yorr.config;

import com.ssafy.yorr.handler.GameWebSocketHandler;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistration;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 허용 출처는 설정 하나에서 나와야 하고, 목록에 없는 출처는 실제로 막혀야 한다.
 * <p>
 * 이전에는 REST와 WebSocket이 각자 목록을 들고 있어 한쪽만 고치면 조용히 어긋났다.
 * 여기서는 <b>두 경로가 같은 값을 쓰는지</b>를 함께 확인한다.
 */
@SpringBootTest(properties = "yorr.cors.allowed-origins=https://allowed.example")
@Testcontainers
class CorsConfigurationTest {

    @Container
    private static final GenericContainer<?> MYSQL =
            new GenericContainer<>(DockerImageName.parse("mysql:8.0"))
                    .withEnv("MYSQL_DATABASE", "yorr")
                    .withEnv("MYSQL_ROOT_PASSWORD", "test")
                    .withExposedPorts(3306);

    @Container
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine")).withExposedPorts(6379);

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

    @Autowired
    private WebApplicationContext context;
    @Autowired
    private CorsProperties cors;
    @Autowired
    private GameWebSocketHandler gameWebSocketHandler;

    private MockMvc mockMvc() {
        return MockMvcBuilders.webAppContextSetup(context).build();
    }

    @Test
    void 허용된_출처의_사전요청은_통과한다() throws Exception {
        mockMvc().perform(options("/api/v1/rooms")
                        .header("Origin", "https://allowed.example")
                        .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://allowed.example"));
    }

    /** 이 테스트가 이번 티켓의 이유다 — 목록에 없는 출처(개발용 localhost 포함)는 막혀야 한다. */
    @Test
    void 목록에_없는_출처는_거절된다() throws Exception {
        mockMvc().perform(options("/api/v1/rooms")
                        .header("Origin", "http://localhost:5173")
                        .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isForbidden());
    }

    /** REST만 막고 WebSocket을 열어두면 의미가 없다 — 소켓도 같은 목록을 받아야 한다. */
    @Test
    void WebSocket도_같은_목록을_쓴다() {
        WebSocketHandlerRegistry registry = mock(WebSocketHandlerRegistry.class);
        WebSocketHandlerRegistration registration = mock(WebSocketHandlerRegistration.class);
        when(registry.addHandler(any(), anyString())).thenReturn(registration);

        new WebSocketConfig(gameWebSocketHandler, cors).registerWebSocketHandlers(registry);

        ArgumentCaptor<String[]> origins = ArgumentCaptor.forClass(String[].class);
        verify(registration).setAllowedOrigins(origins.capture());
        assertThat(origins.getValue()).containsExactly("https://allowed.example");
    }
}
