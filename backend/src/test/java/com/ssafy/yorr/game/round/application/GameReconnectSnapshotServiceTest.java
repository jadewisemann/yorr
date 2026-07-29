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
    }
}
