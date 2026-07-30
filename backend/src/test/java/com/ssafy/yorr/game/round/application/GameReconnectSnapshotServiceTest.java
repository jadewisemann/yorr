package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.service.GameScoreQueryService;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.RoomPhase;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class GameReconnectSnapshotServiceTest {

    @Test
    void includesCurrentRoundDeadlineTurnOrderAndScores() {
        RoomSessionRegistry registry = new RoomSessionRegistry();
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("session-a");
        registry.join("room-a", session, "player-a", "Player A");
        registry.markPhase("room-a", RoomPhase.PLAYING);

        RoundSynchronizationService roundService = mock(RoundSynchronizationService.class);
        when(roundService.findByRoomId("room-a"))
                .thenReturn(Optional.of(RoundState.start(
                        4,
                        List.of("player-a", "player-b")
                )));
        RoundTimerService timerService = mock(RoundTimerService.class);
        Instant deadline = Instant.parse("2026-07-29T08:00:25Z");
        when(timerService.currentDeadline("room-a")).thenReturn(Optional.of(deadline));
        GameScoreQueryService scoreService = mock(GameScoreQueryService.class);
        ScoreBoard score = new ScoreBoard(Map.of("ones", 3), 3, 0, 3);
        when(scoreService.getScoreboards("room-a", "player-a"))
                .thenReturn(Map.of("player-a", score));

        GameReconnectSnapshotService service = new GameReconnectSnapshotService(
                registry,
                roundService,
                timerService,
                scoreService
        );

        var snapshot = service.snapshot("room-a", "player-a");

        assertThat(snapshot.game()).isNotNull();
        assertThat(snapshot.game().roundNumber()).isEqualTo(4);
        assertThat(snapshot.game().activePlayerId()).isEqualTo("player-a");
        assertThat(snapshot.game().roundDeadline()).isEqualTo(deadline.toEpochMilli());
        assertThat(snapshot.game().turnOrder()).containsExactly("player-a", "player-b");
        assertThat(snapshot.game().scores()).containsEntry("player-a", score);
        // 아직 굴리지 않은 턴 — 굴림 0회, 주사위·KEEP은 없음(직렬화에서 빠진다).
        assertThat(snapshot.game().rollCount()).isZero();
        assertThat(snapshot.game().dice()).isNull();
        assertThat(snapshot.game().held()).isNull();
    }

    /**
     * 굴림 진행이 빠지면 재접속한 클라이언트가 0회부터 다시 세고, 그 다음 dice.roll이
     * 서버의 activeRollCount와 어긋나 INVALID_ROLL로 거부된다.
     */
    @Test
    void includesRollProgressOfTheCurrentTurn() {
        RoomSessionRegistry registry = new RoomSessionRegistry();
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("session-a");
        registry.join("room-a", session, "player-a", "Player A");
        registry.markPhase("room-a", RoomPhase.PLAYING);

        RoundState twoRollsIn = RoundState.start(4, List.of("player-a", "player-b"))
                .recordRoll("player-a", 4, 1, noHeld(), List.of(6, 6, 3, 2, 1))
                .recordRoll("player-a", 4, 2, List.of(true, true, false, false, false),
                        List.of(1, 1, 5, 4, 4));

        RoundSynchronizationService roundService = mock(RoundSynchronizationService.class);
        when(roundService.findByRoomId("room-a")).thenReturn(Optional.of(twoRollsIn));
        RoundTimerService timerService = mock(RoundTimerService.class);
        when(timerService.currentDeadline("room-a"))
                .thenReturn(Optional.of(Instant.parse("2026-07-29T08:00:25Z")));
        GameScoreQueryService scoreService = mock(GameScoreQueryService.class);
        when(scoreService.getScoreboards("room-a", "player-a")).thenReturn(Map.of());

        GameReconnectSnapshotService service = new GameReconnectSnapshotService(
                registry,
                roundService,
                timerService,
                scoreService
        );

        var game = service.snapshot("room-a", "player-a").game();

        assertThat(game.rollCount()).isEqualTo(2);
        // KEEP한 두 자리는 첫 굴림 값이 그대로 유지된 채 내려간다.
        assertThat(game.dice()).containsExactly(6, 6, 5, 4, 4);
        assertThat(game.held()).containsExactly(true, true, false, false, false);
    }

    private static List<Boolean> noHeld() {
        return List.of(false, false, false, false, false);
    }
}
