package com.ssafy.yorr.game.repository;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.dto.ScoreConfirmationCommand;
import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionResult;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionService;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
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

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.CATEGORY_ALREADY_USED;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.GAME_NOT_FOUND;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.ROUND_ALREADY_SCORED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@Testcontainers
class RedisScoreBoardStoreIntegrationTest {

    private static final String ROOM_CODE = "ROOM1";
    private static final String GAME_ID = "game-1";
    private static final String PLAYER_ID = "player-1";

    @Container
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine"))
                    .withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redisTemplate;
    private static ScoreConfirmationService service;

    @BeforeAll
    static void connectRedis() {
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getFirstMappedPort());
        connectionFactory.afterPropertiesSet();
        redisTemplate = new StringRedisTemplate(connectionFactory);
        redisTemplate.afterPropertiesSet();
        service = new ScoreConfirmationService(new RedisScoreBoardStore(redisTemplate));
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
        createPlayingGame(GAME_ID);
    }

    @Test
    void confirmsScoreInActualRedis() {
        ScoreConfirmationResult result = confirm(GAME_ID, 1, "choice", 1, 2, 3, 4, 5);

        assertThat(result.score()).isEqualTo(15);
        assertThat(result.scoreboard().categories()).containsEntry("choice", 15);
        assertThat(result.scoreboard().total()).isEqualTo(15);
        assertThat(redisTemplate.opsForHash()
                .get(RoomRedisKeys.gameScoreboardKey(GAME_ID, PLAYER_ID), "choice")).isEqualTo("15");
    }

    @Test
    void distinguishesConfirmedZeroFromUnsubmittedCategory() {
        ScoreBoard scoreboard = confirm(GAME_ID, 1, "yacht", 1, 2, 3, 4, 5).scoreboard();

        assertThat(scoreboard.categories()).containsEntry("yacht", 0);
        assertThat(scoreboard.categories().get("ones")).isNull();
        assertThat(redisTemplate.opsForHash()
                .hasKey(RoomRedisKeys.gameScoreboardKey(GAME_ID, PLAYER_ID), "yacht")).isTrue();
        assertThat(redisTemplate.opsForHash()
                .hasKey(RoomRedisKeys.gameScoreboardKey(GAME_ID, PLAYER_ID), "ones")).isFalse();
    }

    @Test
    void identicalRetryDoesNotAddScoreTwice() {
        confirm(GAME_ID, 1, "choice", 1, 2, 3, 4, 5);
        ScoreBoard retried = confirm(GAME_ID, 1, "choice", 1, 2, 3, 4, 5).scoreboard();

        assertThat(retried.total()).isEqualTo(15);
        assertThat(roomTotal()).isEqualTo("15");
        assertThat(redisTemplate.opsForHash()
                .size(RoomRedisKeys.gameScoreSubmissionsKey(GAME_ID, PLAYER_ID))).isEqualTo(1);
    }

    @Test
    void rejectsDifferentRequestForSameRound() {
        confirm(GAME_ID, 1, "choice", 1, 2, 3, 4, 5);

        assertReason(
                () -> confirm(GAME_ID, 1, "yacht", 6, 6, 6, 6, 6),
                ROUND_ALREADY_SCORED
        );
        assertThat(roomTotal()).isEqualTo("15");
    }

    @Test
    void rejectsCategoryReuseInAnotherRound() {
        confirm(GAME_ID, 1, "choice", 1, 2, 3, 4, 5);

        assertReason(
                () -> confirm(GAME_ID, 2, "choice", 6, 6, 6, 6, 6),
                CATEGORY_ALREADY_USED
        );
        assertThat(roomTotal()).isEqualTo("15");
    }

    @Test
    void concurrentIdenticalRequestsAreAppliedOnce() throws Exception {
        int requestCount = 16;
        ExecutorService executor = Executors.newFixedThreadPool(requestCount);
        CountDownLatch ready = new CountDownLatch(requestCount);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<ScoreConfirmationResult>> futures = new ArrayList<>();

        try {
            for (int index = 0; index < requestCount; index++) {
                futures.add(executor.submit(() -> {
                    ready.countDown();
                    assertThat(start.await(5, TimeUnit.SECONDS)).isTrue();
                    return confirm(GAME_ID, 1, "choice", 1, 2, 3, 4, 5);
                }));
            }

            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            for (Future<ScoreConfirmationResult> future : futures) {
                assertThat(future.get(10, TimeUnit.SECONDS).scoreboard().total()).isEqualTo(15);
            }
        } finally {
            executor.shutdownNow();
        }

        assertThat(roomTotal()).isEqualTo("15");
        assertThat(redisTemplate.opsForHash()
                .size(RoomRedisKeys.gameScoreSubmissionsKey(GAME_ID, PLAYER_ID))).isEqualTo(1);
    }

    @Test
    void awardsUpperBonusExactlyWhenSubtotalReachesSixtyThree() {
        confirm(GAME_ID, 1, "ones", 1, 1, 1, 2, 3);
        confirm(GAME_ID, 2, "twos", 2, 2, 2, 1, 3);
        confirm(GAME_ID, 3, "threes", 3, 3, 3, 1, 2);
        confirm(GAME_ID, 4, "fours", 4, 4, 4, 1, 2);
        confirm(GAME_ID, 5, "fives", 5, 5, 5, 1, 2);
        ScoreBoard scoreboard = confirm(GAME_ID, 6, "sixes", 6, 6, 6, 1, 2).scoreboard();

        assertThat(scoreboard.upperSubtotal()).isEqualTo(63);
        assertThat(scoreboard.upperBonus()).isEqualTo(35);
        assertThat(scoreboard.total()).isEqualTo(98);
        assertThat(roomTotal()).isEqualTo("98");
    }

    @Test
    void keepsDetailedTotalAndRoomTotalEqual() {
        ScoreBoard scoreboard = confirm(GAME_ID, 1, "fullHouse", 3, 3, 3, 5, 5).scoreboard();

        assertThat(scoreboard.total()).isEqualTo(19);
        assertThat(roomTotal()).isEqualTo(String.valueOf(scoreboard.total()));
    }

    @Test
    void staleGameMappingCannotChangeCurrentRoomScore() {
        String staleGameId = "game-stale";
        redisTemplate.opsForHash().put(RoomRedisKeys.gameKey(staleGameId), "roomCode", ROOM_CODE);

        assertReason(
                () -> confirm(staleGameId, 1, "choice", 1, 2, 3, 4, 5),
                GAME_NOT_FOUND
        );

        assertThat(roomTotal()).isEqualTo("0");
        assertThat(redisTemplate.opsForHash()
                .entries(RoomRedisKeys.gameScoreboardKey(staleGameId, PLAYER_ID))).isEmpty();
        assertThat(redisTemplate.opsForHash()
                .entries(RoomRedisKeys.gameScoreSubmissionsKey(staleGameId, PLAYER_ID))).isEmpty();
    }

    @Test
    void actualRedisFailureLeavesRoundSubmissionUncommitted() {
        String staleGameId = "game-stale";
        redisTemplate.opsForHash().put(RoomRedisKeys.gameKey(staleGameId), "roomCode", ROOM_CODE);
        InMemoryRoundStateStore roundStore = new InMemoryRoundStateStore();
        RoundSynchronizationService roundService = new RoundSynchronizationService(roundStore);
        roundService.initialize(ROOM_CODE, 1, List.of(PLAYER_ID));
        ScoreRoundSubmissionService coordinator =
                scoreRoundSubmissionService(roundService, staleGameId);

        assertReason(
                () -> coordinator.submit(
                        ROOM_CODE,
                        PLAYER_ID,
                        new RoundSubmitPayload(1, List.of(1, 2, 3, 4, 5), "choice")
                ),
                GAME_NOT_FOUND
        );

        assertThat(roundStore.findByRoomId(ROOM_CODE)).hasValueSatisfying(state -> {
            assertThat(state.roundNumber()).isEqualTo(1);
            assertThat(state.submittedPlayerIds()).isEmpty();
        });
        assertThat(roomTotal()).isEqualTo("0");
    }

    @Test
    void actualRedisSuccessCommitsScoreBeforeCompletingRound() {
        InMemoryRoundStateStore roundStore = new InMemoryRoundStateStore();
        RoundSynchronizationService roundService = new RoundSynchronizationService(roundStore);
        roundService.initialize(ROOM_CODE, 1, List.of(PLAYER_ID));
        ScoreRoundSubmissionService coordinator =
                scoreRoundSubmissionService(roundService, GAME_ID);

        ScoreRoundSubmissionResult result = coordinator.submit(
                ROOM_CODE,
                PLAYER_ID,
                new RoundSubmitPayload(1, List.of(1, 2, 3, 4, 5), "choice")
        );

        assertThat(result.score().scoreboard().total()).isEqualTo(15);
        assertThat(result.round().roundCompleted()).isTrue();
        assertThat(roomTotal()).isEqualTo("15");
        assertThat(roundStore.findByRoomId(ROOM_CODE)).hasValueSatisfying(state -> {
            assertThat(state.roundNumber()).isEqualTo(2);
            assertThat(state.submittedPlayerIds()).isEmpty();
        });
    }

    private static ScoreConfirmationResult confirm(
            String gameId,
            int roundNumber,
            String category,
            Integer... dice
    ) {
        return service.confirm(new ScoreConfirmationCommand(
                gameId,
                PLAYER_ID,
                roundNumber,
                category,
                List.of(dice)
        ));
    }

    private static void assertReason(
            ThrowingOperation operation,
            ScoreConfirmationException.Reason reason
    ) {
        assertThatThrownBy(operation::run)
                .isInstanceOfSatisfying(ScoreConfirmationException.class, exception ->
                        assertThat(exception.reason()).isEqualTo(reason)
                );
    }

    private static void createPlayingGame(String gameId) {
        redisTemplate.opsForHash().put(RoomRedisKeys.gameKey(gameId), "roomCode", ROOM_CODE);
        redisTemplate.opsForHash().put(RoomRedisKeys.roomKey(ROOM_CODE), "gameId", gameId);
        redisTemplate.opsForHash().put(RoomRedisKeys.roomKey(ROOM_CODE), "phase", "PLAYING");
        redisTemplate.opsForHash().put(RoomRedisKeys.playersKey(ROOM_CODE), PLAYER_ID, "player");
        redisTemplate.opsForHash().put(RoomRedisKeys.scoresKey(ROOM_CODE), PLAYER_ID, "0");
    }

    private static ScoreRoundSubmissionService scoreRoundSubmissionService(
            RoundSynchronizationService roundService,
            String gameId
    ) {
        RoomService roomService = mock(RoomService.class);
        when(roomService.getSnapshot(ROOM_CODE)).thenReturn(new RoomSnapshot(
                ROOM_CODE,
                gameId,
                PLAYER_ID,
                RoomPhase.PLAYING,
                1,
                List.of()
        ));
        return new ScoreRoundSubmissionService(roundService, service, roomService);
    }

    private static String roomTotal() {
        Object value = redisTemplate.opsForHash()
                .get(RoomRedisKeys.scoresKey(ROOM_CODE), PLAYER_ID);
        return value == null ? null : value.toString();
    }

    @FunctionalInterface
    private interface ThrowingOperation {
        void run();
    }
}
