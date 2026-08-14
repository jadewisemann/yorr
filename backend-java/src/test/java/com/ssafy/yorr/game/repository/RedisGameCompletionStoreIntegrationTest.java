package com.ssafy.yorr.game.repository;

import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.service.RoomValidationService;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 게임 종료 전이는 이 Lua 하나에 달려 있다 — 여기가 틀리면 게임이 안 끝나거나(무한 라운드),
 * 진행 중인 게임이 끝나버린다. 두 경우 모두 상태가 통째로 꼬이므로 실제 Redis로 검증한다.
 */
@Testcontainers
class RedisGameCompletionStoreIntegrationTest {

    private static final String ROOM_CODE = "ROOM1";
    private static final String GAME_ID = "game-1";
    private static final List<String> PLAYERS = List.of("player-1", "player-2");

    @Container
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine"))
                    .withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redisTemplate;
    private static RedisGameCompletionStore store;
    private static RoomValidationService roomService;

    @BeforeAll
    static void connectRedis() {
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getFirstMappedPort());
        connectionFactory.afterPropertiesSet();
        redisTemplate = new StringRedisTemplate(connectionFactory);
        redisTemplate.afterPropertiesSet();
        store = new RedisGameCompletionStore(redisTemplate);
        roomService = new RoomValidationService(redisTemplate);
    }

    @AfterAll
    static void disconnectRedis() {
        if (connectionFactory != null) {
            connectionFactory.destroy();
        }
    }

    @BeforeEach
    void resetRedis() {
        try (RedisConnection connection = redisTemplate.getConnectionFactory().getConnection()) {
            connection.serverCommands().flushAll();
        }
        redisTemplate.opsForHash().put(RoomRedisKeys.roomKey(ROOM_CODE), "phase", "PLAYING");
        redisTemplate.opsForHash().put(RoomRedisKeys.roomKey(ROOM_CODE), "gameId", GAME_ID);
        redisTemplate.opsForHash().put(RoomRedisKeys.roomKey(ROOM_CODE), "capacity", "6");
        redisTemplate.opsForHash().put(RoomRedisKeys.roomKey(ROOM_CODE), "hostId", PLAYERS.get(0));
        redisTemplate.opsForHash().put(RoomRedisKeys.roomKey(ROOM_CODE), "gameCode", "YACHT_DICE");
        PLAYERS.forEach(playerId -> {
            redisTemplate.opsForHash().put(RoomRedisKeys.playersKey(ROOM_CODE), playerId, playerId);
            redisTemplate.opsForHash().put(RoomRedisKeys.scoresKey(ROOM_CODE), playerId, "0");
        });
    }

    @Test
    void doesNotFinishWhileAnyPlayerHasAnEmptyCategory() {
        fillScoreboard(PLAYERS.get(0), 12);
        fillScoreboard(PLAYERS.get(1), 11);

        assertThat(store.finishIfComplete(ROOM_CODE, GAME_ID, false)).isFalse();
        assertThat(phase()).isEqualTo("PLAYING");
    }

    @Test
    void finishesOnceEveryPlayerFilledAllCategories() {
        PLAYERS.forEach(playerId -> fillScoreboard(playerId, 12));

        assertThat(store.finishIfComplete(ROOM_CODE, GAME_ID, false)).isTrue();
        assertThat(phase()).isEqualTo("FINISHED");
    }

    /** 메타 필드(_total 등)를 칸으로 세면 실제보다 빨리 끝난다. 그 경계를 고정한다. */
    @Test
    void doesNotCountMetaFieldsAsRecordedCategories() {
        PLAYERS.forEach(playerId -> {
            fillScoreboard(playerId, 11);
            redisTemplate.opsForHash()
                    .put(RoomRedisKeys.gameScoreboardKey(GAME_ID, playerId), "_total", "100");
        });

        assertThat(store.finishIfComplete(ROOM_CODE, GAME_ID, false)).isFalse();
        assertThat(phase()).isEqualTo("PLAYING");
    }

    /** 라운드 상한 안전망: 타임아웃으로 빈 칸이 남아도 종료할 수 있어야 한다. */
    @Test
    void forceFinishesEvenWithEmptyCategories() {
        assertThat(store.finishIfComplete(ROOM_CODE, GAME_ID, true)).isTrue();
        assertThat(phase()).isEqualTo("FINISHED");
    }

    /**
     * 동시에 여러 호출이 들어와도 true는 한 번만 나와야 한다 —
     * 이 보장이 곧 game.over 중복 방송 불가다.
     */
    @Test
    void onlyOneConcurrentCallPerformsTheTransition() throws Exception {
        PLAYERS.forEach(playerId -> fillScoreboard(playerId, 12));
        ExecutorService executor = Executors.newFixedThreadPool(8);
        try {
            List<Callable<Boolean>> calls = java.util.stream.IntStream.range(0, 8)
                    .<Callable<Boolean>>mapToObj(ignored ->
                            () -> store.finishIfComplete(ROOM_CODE, GAME_ID, false))
                    .toList();

            List<Future<Boolean>> results = executor.invokeAll(calls);

            long transitions = 0;
            for (Future<Boolean> result : results) {
                if (result.get()) {
                    transitions++;
                }
            }
            assertThat(transitions).isEqualTo(1);
        } finally {
            executor.shutdownNow();
            executor.awaitTermination(5, TimeUnit.SECONDS);
        }
    }

    @Test
    void ignoresStaleGameId() {
        PLAYERS.forEach(playerId -> fillScoreboard(playerId, 12));

        assertThat(store.finishIfComplete(ROOM_CODE, "other-game", false)).isFalse();
        assertThat(phase()).isEqualTo("PLAYING");
    }

    @Test
    void readsTotalsForRanking() {
        redisTemplate.opsForHash().put(RoomRedisKeys.scoresKey(ROOM_CODE), PLAYERS.get(0), "180");
        redisTemplate.opsForHash().put(RoomRedisKeys.scoresKey(ROOM_CODE), PLAYERS.get(1), "205");

        assertThat(store.readTotals(ROOM_CODE))
                .containsEntry(PLAYERS.get(0), 180)
                .containsEntry(PLAYERS.get(1), 205);
    }

    /**
     * 대기실 복귀에서 총점 초기화가 빠지면 다음 게임 순위에 지난 게임 점수가 얹힌다.
     * 총점 해시는 gameId가 아니라 방에 매달려 있어서 자동으로 비워지지 않는다.
     */
    @Test
    void returnToLobbyResetsTotalsAndAllowsANewGame() {
        PLAYERS.forEach(playerId -> fillScoreboard(playerId, 12));
        redisTemplate.opsForHash().put(RoomRedisKeys.scoresKey(ROOM_CODE), PLAYERS.get(0), "180");
        store.finishIfComplete(ROOM_CODE, GAME_ID, false);

        assertThat(roomService.returnToLobby(ROOM_CODE)).isTrue();

        assertThat(phase()).isEqualTo("LOBBY");
        assertThat(store.readTotals(ROOM_CODE)).containsOnlyKeys(PLAYERS.toArray(String[]::new));
        assertThat(store.readTotals(ROOM_CODE).values()).containsOnly(0);
        assertThat(redisTemplate.opsForHash().get(RoomRedisKeys.roomKey(ROOM_CODE), "gameId")).isNull();
        // 되돌린 뒤에는 같은 멤버로 새 게임을 시작할 수 있어야 한다.
        assertThat(roomService.startGame(ROOM_CODE).gameId()).isNotEqualTo(GAME_ID);
    }

    @Test
    void returnToLobbyRejectsAGameStillInProgress() {
        assertThat(roomService.returnToLobby(ROOM_CODE)).isFalse();
        assertThat(phase()).isEqualTo("PLAYING");
    }

    private static String phase() {
        return (String) redisTemplate.opsForHash().get(RoomRedisKeys.roomKey(ROOM_CODE), "phase");
    }

    private static void fillScoreboard(String playerId, int categoryCount) {
        String key = RoomRedisKeys.gameScoreboardKey(GAME_ID, playerId);
        ScoreCategory[] categories = ScoreCategory.values();
        for (int index = 0; index < categoryCount; index++) {
            redisTemplate.opsForHash().put(key, categories[index].apiKey(), "10");
        }
    }
}
