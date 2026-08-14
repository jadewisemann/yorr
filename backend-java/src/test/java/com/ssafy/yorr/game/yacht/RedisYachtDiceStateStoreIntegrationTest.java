package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.room.RoomRedisKeys;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class RedisYachtDiceStateStoreIntegrationTest {

    private static final String ROOM = "ROOM1";
    private static final List<Boolean> HELD = List.of(false, false, false, false, false);

    @Container
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine")).withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redis;
    private static RedisYachtDiceStateStore store;

    @BeforeAll
    static void connect() {
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getFirstMappedPort());
        connectionFactory.afterPropertiesSet();
        redis = new StringRedisTemplate(connectionFactory);
        redis.afterPropertiesSet();
        store = new RedisYachtDiceStateStore(redis, JsonMapper.builder().build());
    }

    @AfterAll
    static void disconnect() {
        if (connectionFactory != null) connectionFactory.destroy();
    }

    @BeforeEach
    void reset() {
        try (RedisConnection connection = redis.getConnectionFactory().getConnection()) {
            connection.serverCommands().flushAll();
        }
        redis.opsForHash().put(RoomRedisKeys.roomKey(ROOM), "phase", "PLAYING");
        store.initialize(ROOM, RoundState.start(1, List.of("player-a")));
    }

    @Test
    void restoresTheGameSpecificStateFromRedis() {
        store.recordRollAtomically(
                ROOM, "player-a", 1, 1, HELD, List.of(1, 2, 3, 4, 5)
        );

        assertThat(store.findByRoomId(ROOM)).hasValueSatisfying(state -> {
            assertThat(state.activeRollCount()).isEqualTo(1);
            assertThat(state.activeDice()).containsExactly(1, 2, 3, 4, 5);
        });
    }

    @Test
    void acceptsOnlyOneConcurrentChangeForTheSameTurn() throws Exception {
        try (var executor = Executors.newFixedThreadPool(2)) {
            Callable<Boolean> roll = () -> {
                try {
                    store.recordRollAtomically(
                            ROOM, "player-a", 1, 1, HELD, List.of(1, 2, 3, 4, 5)
                    );
                    return true;
                } catch (RuntimeException exception) {
                    return false;
                }
            };

            var results = executor.invokeAll(List.of(roll, roll));

            assertThat(results).extracting(future -> future.get()).containsExactlyInAnyOrder(true, false);
            assertThat(store.findByRoomId(ROOM).orElseThrow().activeRollCount()).isEqualTo(1);
        }
    }
}
