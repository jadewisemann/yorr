package com.ssafy.yorr.game.service;

import com.ssafy.yorr.game.domain.GameResult;
import com.ssafy.yorr.game.domain.GameScoreSnapshot;
import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.exception.GameScoreQueryException;
import com.ssafy.yorr.game.repository.GameScoreQueryStore;
import com.ssafy.yorr.room.dto.RoomPhase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.GAME_NOT_FINISHED;
import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.GAME_NOT_STARTED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GameScoreQueryServiceTest {

    private GameScoreQueryStore store;
    private GameScoreQueryService service;

    @BeforeEach
    void setUp() {
        store = mock(GameScoreQueryStore.class);
        service = new GameScoreQueryService(store);
    }

    @Test
    void returnsScoreboardsWhileGameIsPlaying() {
        ScoreBoard playerA = scoreBoard(120);
        ScoreBoard playerB = scoreBoard(80);
        when(store.findByRoomId("room-a", "player-a"))
                .thenReturn(snapshot(RoomPhase.PLAYING, Map.of(
                        "player-a", playerA,
                        "player-b", playerB
                )));

        Map<String, ScoreBoard> result = service.getScoreboards("room-a", "player-a");

        assertThat(result).containsEntry("player-a", playerA)
                .containsEntry("player-b", playerB);
    }

    @Test
    void rejectsScoreboardBeforeGameStarts() {
        when(store.findByRoomId("room-a", "player-a"))
                .thenReturn(snapshot(RoomPhase.LOBBY, Map.of("player-a", scoreBoard(0))));

        assertReason(
                () -> service.getScoreboards("room-a", "player-a"),
                GAME_NOT_STARTED
        );
    }

    @Test
    void calculatesCompetitionRankingFromFinishedScoreboards() {
        when(store.findByRoomId("room-a", "player-a"))
                .thenReturn(snapshot(RoomPhase.FINISHED, Map.of(
                        "player-a", scoreBoard(200),
                        "player-b", scoreBoard(150),
                        "player-c", scoreBoard(150),
                        "player-d", scoreBoard(100)
                )));

        GameResult result = service.getResults("room-a", "player-a");

        assertThat(result.players()).extracting(player -> player.playerId())
                .containsExactly("player-a", "player-b", "player-c", "player-d");
        assertThat(result.players()).extracting(player -> player.rank())
                .containsExactly(1, 2, 2, 4);
        assertThat(result.isTie()).isFalse();
    }

    @Test
    void detectsJointWinners() {
        when(store.findByRoomId("room-a", "player-a"))
                .thenReturn(snapshot(RoomPhase.FINISHED, Map.of(
                        "player-a", scoreBoard(200),
                        "player-b", scoreBoard(200)
                )));

        GameResult result = service.getResults("room-a", "player-a");

        assertThat(result.players()).extracting(player -> player.rank())
                .containsExactly(1, 1);
        assertThat(result.isTie()).isTrue();
    }

    @Test
    void rejectsResultsBeforeGameFinishes() {
        when(store.findByRoomId("room-a", "player-a"))
                .thenReturn(snapshot(RoomPhase.PLAYING, Map.of("player-a", scoreBoard(10))));

        assertReason(
                () -> service.getResults("room-a", "player-a"),
                GAME_NOT_FINISHED
        );
    }

    private static GameScoreSnapshot snapshot(
            RoomPhase phase,
            Map<String, ScoreBoard> scoreboards
    ) {
        return new GameScoreSnapshot("room-a", "game-a", phase, scoreboards);
    }

    private static ScoreBoard scoreBoard(int total) {
        return new ScoreBoard(Map.of(), 0, 0, total);
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
