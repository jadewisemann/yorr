package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.dto.ScoreConfirmationCommand;
import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;

import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.GAME_NOT_FOUND;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.STORE_FAILURE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ScoreRoundSubmissionServiceTest {

    private InMemoryRoundStateStore roundStateStore;
    private RoundSynchronizationService roundSynchronizationService;
    private ScoreConfirmationService scoreConfirmationService;
    private RoomService roomService;
    private ScoreRoundSubmissionService service;

    @BeforeEach
    void setUp() {
        roundStateStore = new InMemoryRoundStateStore();
        roundSynchronizationService = new RoundSynchronizationService(roundStateStore, () -> 1);
        scoreConfirmationService = mock(ScoreConfirmationService.class);
        roomService = mock(RoomService.class);
        service = new ScoreRoundSubmissionService(
                roundSynchronizationService,
                scoreConfirmationService,
                roomService
        );
    }

    @Test
    void confirmsScoreBeforeRecordingRoundSubmission() {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        roll("player-a");
        givenPlayingGame("room-a", "game-a");
        ScoreConfirmationResult confirmed = confirmedScore("game-a", "player-a", 15);
        when(scoreConfirmationService.confirm(any())).thenReturn(confirmed);

        ScoreRoundSubmissionResult result =
                service.submit("room-a", "player-a", payload());

        ArgumentCaptor<ScoreConfirmationCommand> commandCaptor =
                ArgumentCaptor.forClass(ScoreConfirmationCommand.class);
        verify(scoreConfirmationService).confirm(commandCaptor.capture());
        assertThat(commandCaptor.getValue()).isEqualTo(new ScoreConfirmationCommand(
                "game-a",
                "player-a",
                1,
                "choice",
                List.of(1, 1, 1, 1, 1)
        ));
        assertThat(result.score()).isEqualTo(confirmed);
        assertThat(result.round().roundCompleted()).isFalse();
        assertThat(roundStateStore.findByRoomId("room-a")).hasValueSatisfying(state ->
                assertThat(state.submittedPlayerIds()).containsExactly("player-a")
        );
    }

    @Test
    void scoreFailureLeavesPlayerUnsubmittedAndAllowsRetry() {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a"));
        roll("player-a");
        givenPlayingGame("room-a", "game-a");
        when(scoreConfirmationService.confirm(any()))
                .thenThrow(new ScoreConfirmationException(STORE_FAILURE, "redis unavailable"));

        assertThatThrownBy(() -> service.submit("room-a", "player-a", payload()))
                .isInstanceOfSatisfying(ScoreConfirmationException.class, exception ->
                        assertThat(exception.reason()).isEqualTo(STORE_FAILURE)
                );
        assertThat(roundStateStore.findByRoomId("room-a")).hasValueSatisfying(state -> {
            assertThat(state.roundNumber()).isEqualTo(1);
            assertThat(state.submittedPlayerIds()).isEmpty();
        });

        doReturn(confirmedScore("game-a", "player-a", 15))
                .when(scoreConfirmationService)
                .confirm(any());

        ScoreRoundSubmissionResult retried =
                service.submit("room-a", "player-a", payload());

        assertThat(retried.round().roundCompleted()).isTrue();
        assertThat(roundStateStore.findByRoomId("room-a")).hasValueSatisfying(state -> {
            assertThat(state.roundNumber()).isEqualTo(2);
            assertThat(state.submittedPlayerIds()).isEmpty();
        });
    }

    @Test
    void missingCurrentGameLeavesRoundStateUnchanged() {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a"));
        roll("player-a");
        when(roomService.getSnapshot("room-a")).thenReturn(RoomSnapshot.notFound("room-a"));

        assertThatThrownBy(() -> service.submit("room-a", "player-a", payload()))
                .isInstanceOfSatisfying(ScoreConfirmationException.class, exception ->
                        assertThat(exception.reason()).isEqualTo(GAME_NOT_FOUND)
                );

        verify(scoreConfirmationService, never()).confirm(any());
        assertThat(roundStateStore.findByRoomId("room-a")).hasValueSatisfying(state ->
                assertThat(state.submittedPlayerIds()).isEmpty()
        );
    }

    private void givenPlayingGame(String roomId, String gameId) {
        when(roomService.getSnapshot(roomId)).thenReturn(new RoomSnapshot(
                roomId,
                gameId,
                "player-a",
                RoomPhase.PLAYING,
                2,
                List.of()
        ));
    }

    private static RoundSubmitPayload payload() {
        return new RoundSubmitPayload(1, List.of(1, 1, 1, 1, 1), "choice");
    }

    private void roll(String playerId) {
        roundSynchronizationService.recordRoll("room-a", playerId,
                new com.ssafy.yorr.ws.dto.DiceRollPayload(
                        1, 1, List.of(false, false, false, false, false)));
    }

    private static ScoreConfirmationResult confirmedScore(
            String gameId,
            String playerId,
            int score
    ) {
        return new ScoreConfirmationResult(
                gameId,
                playerId,
                1,
                "choice",
                score,
                new ScoreBoard(Map.of("choice", score), 0, 0, score)
        );
    }
}
