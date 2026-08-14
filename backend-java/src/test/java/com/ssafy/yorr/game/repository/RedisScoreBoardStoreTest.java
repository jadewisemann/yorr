package com.ssafy.yorr.game.repository;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.CATEGORY_ALREADY_USED;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.GAME_NOT_ACTIVE;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.GAME_NOT_FOUND;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.PLAYER_NOT_IN_GAME;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.ROUND_ALREADY_SCORED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RedisScoreBoardStoreTest {

    private RedisTemplate<String, String> redisTemplate;
    private HashOperations<String, Object, Object> hashOperations;
    private RedisScoreBoardStore store;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        redisTemplate = mock(RedisTemplate.class);
        hashOperations = mock(HashOperations.class);
        when(redisTemplate.<Object, Object>opsForHash()).thenReturn(hashOperations);
        store = new RedisScoreBoardStore(redisTemplate);
    }

    @Test
    void returnsScoreboardWithConfirmedZeroAndUnfilledCategories() {
        givenGame("ROOM1");
        givenScriptResult(0L);
        Map<Object, Object> stored = new HashMap<>();
        stored.put("ones", "0");
        stored.put("_upperSubtotal", "0");
        stored.put("_upperBonus", "0");
        stored.put("_total", "0");
        when(hashOperations.entries("game:game-1:scoreboard:player-1")).thenReturn(stored);

        ScoreBoard scoreboard = confirm(ScoreCategory.ACES, 0);

        assertThat(scoreboard.categories()).containsEntry("ones", 0);
        assertThat(scoreboard.categories().get("twos")).isNull();
        assertThat(scoreboard.upperSubtotal()).isZero();
        assertThat(scoreboard.total()).isZero();
    }

    @Test
    void readsCurrentScoreboardOnIdempotentRetry() {
        givenGame("ROOM1");
        givenScriptResult(5L);
        when(hashOperations.entries("game:game-1:scoreboard:player-1"))
                .thenReturn(Map.of(
                        "choice", "15",
                        "_upperSubtotal", "0",
                        "_upperBonus", "0",
                        "_total", "15"
                ));

        ScoreBoard scoreboard = confirm(ScoreCategory.CHOICE, 15);

        assertThat(scoreboard.categories()).containsEntry("choice", 15);
        assertThat(scoreboard.total()).isEqualTo(15);
    }

    @Test
    void rejectsMissingGameBeforeExecutingScript() {
        when(hashOperations.get("game:game-1", "roomCode")).thenReturn(null);

        assertThatThrownBy(() -> confirm(ScoreCategory.CHOICE, 15))
                .isInstanceOfSatisfying(ScoreConfirmationException.class, exception ->
                        assertThat(exception.reason()).isEqualTo(GAME_NOT_FOUND)
                );
        verify(redisTemplate, never()).execute(
                any(RedisScript.class),
                anyList(),
                any(Object[].class)
        );
    }

    @Test
    void mapsRedisConflictResultsToDomainErrors() {
        givenGame("ROOM1");

        givenScriptResult(3L);
        assertReason(PLAYER_NOT_IN_GAME);

        givenScriptResult(4L);
        assertReason(ROUND_ALREADY_SCORED);

        givenScriptResult(6L);
        assertReason(CATEGORY_ALREADY_USED);
    }

    @Test
    void rejectsMissingRoomStaleRoomGameAndInactiveGame() {
        givenGame("ROOM1");

        givenScriptResult(7L);
        assertReason(GAME_NOT_FOUND);

        givenScriptResult(8L);
        assertReason(GAME_NOT_FOUND);

        givenScriptResult(9L);
        assertReason(GAME_NOT_ACTIVE);
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void validatesCurrentRoomGamePhaseAndMembershipInsideLuaScript() {
        givenGame("ROOM1");
        givenScriptResult(0L);
        when(hashOperations.entries("game:game-1:scoreboard:player-1")).thenReturn(Map.of());

        confirm(ScoreCategory.CHOICE, 15);

        ArgumentCaptor<RedisScript<Long>> scriptCaptor =
                ArgumentCaptor.forClass((Class) RedisScript.class);
        ArgumentCaptor<List<String>> keysCaptor =
                ArgumentCaptor.forClass((Class) List.class);
        ArgumentCaptor<Object[]> argumentsCaptor = ArgumentCaptor.forClass(Object[].class);
        verify(redisTemplate).execute(
                scriptCaptor.capture(),
                keysCaptor.capture(),
                argumentsCaptor.capture()
        );

        assertThat(keysCaptor.getValue()).containsExactly(
                "game:game-1",
                "room:ROOM1",
                "room:ROOM1:players",
                "game:game-1:scoreboard:player-1",
                "game:game-1:score-submissions:player-1",
                "room:ROOM1:scores"
        );
        assertThat(argumentsCaptor.getValue()).containsExactly(
                "ROOM1",
                "game-1",
                "player-1",
                "1",
                "choice",
                "15",
                "0",
                "choice:1,2,3,4,5"
        );
        assertThat(scriptCaptor.getValue().getScriptAsString())
                .contains("redis.call('EXISTS', KEYS[2])")
                .contains("redis.call('HGET', KEYS[2], 'gameId') ~= ARGV[2]")
                .contains("redis.call('HGET', KEYS[2], 'phase') ~= 'PLAYING'")
                .contains("redis.call('HEXISTS', KEYS[3], ARGV[3])");
    }

    private void assertReason(ScoreConfirmationException.Reason reason) {
        assertThatThrownBy(() -> confirm(ScoreCategory.CHOICE, 15))
                .isInstanceOfSatisfying(ScoreConfirmationException.class, exception ->
                        assertThat(exception.reason()).isEqualTo(reason)
                );
    }

    private ScoreBoard confirm(ScoreCategory category, int score) {
        return store.confirmScore(
                "game-1",
                "player-1",
                1,
                category,
                score,
                category.apiKey() + ":1,2,3,4,5"
        );
    }

    private void givenGame(String roomCode) {
        when(hashOperations.get("game:game-1", "roomCode")).thenReturn(roomCode);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void givenScriptResult(long result) {
        when(redisTemplate.execute(
                any(RedisScript.class),
                anyList(),
                any(Object[].class)
        )).thenReturn(result);
    }
}
