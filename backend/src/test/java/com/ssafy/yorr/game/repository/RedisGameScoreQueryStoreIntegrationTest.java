package com.ssafy.yorr.game.repository;

import com.ssafy.yorr.game.domain.GameResult;
import com.ssafy.yorr.game.domain.GameScoreSnapshot;
import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.exception.GameScoreQueryException;
import com.ssafy.yorr.game.service.GameScoreQueryService;
import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.user.dto.GuestCreateResponse;
import com.ssafy.yorr.user.service.UserService;
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

import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.PLAYER_NOT_IN_ROOM;
import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.ROOM_NOT_FOUND;
import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.STORE_FAILURE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers
class RedisGameScoreQueryStoreIntegrationTest {

    private static final String ROOM_ID = "ROOM1";
    private static final String GAME_ID = "game-1";

    @Container
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine"))
                    .withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redisTemplate;
    private static RedisGameScoreQueryStore store;

    @BeforeAll
    static void connectRedis() {
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getFirstMappedPort());
        connectionFactory.afterPropertiesSet();
        redisTemplate = new StringRedisTemplate(connectionFactory);
        redisTemplate.afterPropertiesSet();
        store = new RedisGameScoreQueryStore(redisTemplate);
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
        createGame(RoomPhase.PLAYING);
    }

    @Test
    void loadsEveryParticipantIncludingEmptyScoreboard() {
        putScoreBoard("player-a", Map.of(
                "yacht", "0",
                "_upperSubtotal", "0",
                "_upperBonus", "0",
                "_total", "0"
        ));

        GameScoreSnapshot snapshot = store.findByRoomId(ROOM_ID, "player-a");

        assertThat(snapshot.gameId()).isEqualTo(GAME_ID);
        assertThat(snapshot.phase()).isEqualTo(RoomPhase.PLAYING);
        assertThat(snapshot.scoreboards().keySet())
                .containsExactly("player-a", "player-b", "player-c");

        ScoreBoard playerA = snapshot.scoreboards().get("player-a");
        assertThat(playerA.categories()).containsEntry("yacht", 0);
        assertThat(playerA.categories().get("ones")).isNull();

        ScoreBoard playerB = snapshot.scoreboards().get("player-b");
        assertThat(playerB.categories().values()).containsOnlyNulls();
        assertThat(playerB.total()).isZero();
    }

    @Test
    void returnsStoredSubtotalBonusAndTotal() {
        putScoreBoard("player-a", Map.of(
                "sixes", "18",
                "_upperSubtotal", "63",
                "_upperBonus", "35",
                "_total", "98"
        ));

        ScoreBoard scoreBoard = store.findByRoomId(ROOM_ID, "player-a")
                .scoreboards().get("player-a");

        assertThat(scoreBoard.categories()).containsEntry("sixes", 18);
        assertThat(scoreBoard.upperSubtotal()).isEqualTo(63);
        assertThat(scoreBoard.upperBonus()).isEqualTo(35);
        assertThat(scoreBoard.total()).isEqualTo(98);
    }

    @Test
    void rejectsNonParticipant() {
        assertReason(
                () -> store.findByRoomId(ROOM_ID, "outsider"),
                PLAYER_NOT_IN_ROOM
        );
    }

    @Test
    void rejectsMissingRoom() {
        assertReason(
                () -> store.findByRoomId("UNKNOWN", "player-a"),
                ROOM_NOT_FOUND
        );
    }

    @Test
    void rejectsMismatchedGameMapping() {
        redisTemplate.opsForHash().put(
                RoomRedisKeys.gameKey(GAME_ID),
                "roomCode",
                "ANOTHER"
        );

        assertReason(
                () -> store.findByRoomId(ROOM_ID, "player-a"),
                ROOM_NOT_FOUND
        );
    }

    @Test
    void rejectsCorruptedScoreboardValue() {
        putScoreBoard("player-a", Map.of("_total", "not-a-number"));

        assertReason(
                () -> store.findByRoomId(ROOM_ID, "player-a"),
                STORE_FAILURE
        );
    }

    @Test
    void rejectsTokenOwnedByDifferentUserId() {
        UserService userService = new UserService(redisTemplate);
        GuestCreateResponse playerA = userService.createGuest("player-a");
        GuestCreateResponse playerB = userService.createGuest("player-b");

        assertThatThrownBy(() -> userService.authenticate(
                playerB.userId(),
                "Bearer " + playerA.sessionToken()
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("invalid_guest_session");
    }

    @Test
    void calculatesFinishedGameResultsFromRedisSnapshot() {
        redisTemplate.opsForHash().put(RoomRedisKeys.roomKey(ROOM_ID), "phase", "FINISHED");
        putScoreBoard("player-a", Map.of("_total", "200"));
        putScoreBoard("player-b", Map.of("_total", "200"));
        putScoreBoard("player-c", Map.of("_total", "100"));
        GameScoreQueryService service = new GameScoreQueryService(store);

        GameResult result = service.getResults(ROOM_ID, "player-a");

        assertThat(result.players()).extracting(player -> player.playerId())
                .containsExactly("player-a", "player-b", "player-c");
        assertThat(result.players()).extracting(player -> player.rank())
                .containsExactly(1, 1, 3);
        assertThat(result.isTie()).isTrue();
    }

    private static void createGame(RoomPhase phase) {
        redisTemplate.opsForHash().putAll(RoomRedisKeys.roomKey(ROOM_ID), Map.of(
                "gameId", GAME_ID,
                "phase", phase.name()
        ));
        redisTemplate.opsForHash().putAll(RoomRedisKeys.playersKey(ROOM_ID), Map.of(
                "player-c", "C",
                "player-a", "A",
                "player-b", "B"
        ));
        redisTemplate.opsForHash().put(
                RoomRedisKeys.gameKey(GAME_ID),
                "roomCode",
                ROOM_ID
        );
    }

    private static void putScoreBoard(String playerId, Map<String, String> values) {
        redisTemplate.opsForHash().putAll(
                RoomRedisKeys.gameScoreboardKey(GAME_ID, playerId),
                values
        );
    }

    private static void assertReason(
            ThrowingOperation operation,
            GameScoreQueryException.Reason reason
    ) {
        assertThatThrownBy(operation::run)
                .isInstanceOfSatisfying(GameScoreQueryException.class, exception ->
                        assertThat(exception.reason()).isEqualTo(reason)
                );
    }

    @FunctionalInterface
    private interface ThrowingOperation {
        void run();
    }
}
