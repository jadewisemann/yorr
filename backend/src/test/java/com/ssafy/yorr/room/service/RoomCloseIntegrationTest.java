package com.ssafy.yorr.room.service;

import com.ssafy.yorr.room.RoomRedisKeys;
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

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 빈 방 닫기가 <b>정말로</b> 키를 남기지 않는지 실제 Redis에서 확인한다.
 * 게임 키는 Lua 안에서 이름을 조립하므로 규약이 어긋나면 조용히 남는다 — 그걸 잡는 테스트다.
 */
@Testcontainers
class RoomCloseIntegrationTest {

    private static final String ROOM_CODE = "ROOM9";
    private static final String GAME_ID = "game-9";
    private static final String HOST = "player-1";
    private static final String GUEST = "player-2";

    @Container
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine"))
                    .withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redisTemplate;
    private static RoomValidationService rooms;

    @BeforeAll
    static void connectRedis() {
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getFirstMappedPort());
        connectionFactory.afterPropertiesSet();
        redisTemplate = new StringRedisTemplate(connectionFactory);
        redisTemplate.afterPropertiesSet();
        rooms = new RoomValidationService(redisTemplate);
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
    }

    @Test
    void closeRemovesEveryKeyOfAPlayingRoom() {
        givenPlayingRoom();

        rooms.close(ROOM_CODE);

        assertThat(exists(RoomRedisKeys.roomKey(ROOM_CODE))).isFalse();
        assertThat(exists(RoomRedisKeys.playersKey(ROOM_CODE))).isFalse();
        assertThat(exists(RoomRedisKeys.scoresKey(ROOM_CODE))).isFalse();
        assertThat(exists(RoomRedisKeys.gameKey(GAME_ID))).isFalse();
        for (String player : new String[] { HOST, GUEST }) {
            assertThat(exists(RoomRedisKeys.gameScoreboardKey(GAME_ID, player))).isFalse();
            assertThat(exists(RoomRedisKeys.gameScoreSubmissionsKey(GAME_ID, player))).isFalse();
        }
    }

    @Test
    void closeRemovesALobbyRoomThatNeverStartedAGame() {
        redisTemplate.opsForHash().putAll(RoomRedisKeys.roomKey(ROOM_CODE), Map.of(
                "capacity", "6", "members", "1", "phase", "LOBBY", "hostId", HOST));
        redisTemplate.opsForHash().put(RoomRedisKeys.playersKey(ROOM_CODE), HOST, "호스트");

        rooms.close(ROOM_CODE);

        assertThat(exists(RoomRedisKeys.roomKey(ROOM_CODE))).isFalse();
        assertThat(exists(RoomRedisKeys.playersKey(ROOM_CODE))).isFalse();
    }

    @Test
    void closingAnAlreadyGoneRoomIsHarmless() {
        rooms.close(ROOM_CODE);

        assertThat(exists(RoomRedisKeys.roomKey(ROOM_CODE))).isFalse();
    }

    @Test
    void closeLeavesOtherRoomsAlone() {
        givenPlayingRoom();
        redisTemplate.opsForHash().putAll(RoomRedisKeys.roomKey("OTHER"), Map.of(
                "capacity", "6", "members", "1", "phase", "LOBBY", "hostId", "player-9"));

        rooms.close(ROOM_CODE);

        assertThat(exists(RoomRedisKeys.roomKey("OTHER"))).isTrue();
    }

    private void givenPlayingRoom() {
        redisTemplate.opsForHash().putAll(RoomRedisKeys.roomKey(ROOM_CODE), Map.of(
                "capacity", "6", "members", "2", "phase", "PLAYING", "hostId", HOST, "gameId", GAME_ID));
        redisTemplate.opsForHash().putAll(RoomRedisKeys.playersKey(ROOM_CODE), Map.of(
                HOST, "호스트", GUEST, "참가자"));
        redisTemplate.opsForHash().putAll(RoomRedisKeys.scoresKey(ROOM_CODE), Map.of(
                HOST, "12", GUEST, "8"));
        redisTemplate.opsForHash().put(RoomRedisKeys.gameKey(GAME_ID), "roomCode", ROOM_CODE);
        for (String player : new String[] { HOST, GUEST }) {
            redisTemplate.opsForHash().put(RoomRedisKeys.gameScoreboardKey(GAME_ID, player), "choice", "12");
            redisTemplate.opsForHash().put(RoomRedisKeys.gameScoreSubmissionsKey(GAME_ID, player), "1", "choice:1,2,3,4,5");
        }
    }

    private static boolean exists(String key) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(key));
    }
}
