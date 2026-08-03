package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.application.RoundTimerService;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionResult;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionService;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.DiceBroadcastPayload;
import com.ssafy.yorr.ws.dto.DiceHoldChangedPayload;
import com.ssafy.yorr.ws.dto.DiceHoldPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class YachtTurnActionServiceTest {

    private RoundSynchronizationService rounds;
    private RoundTimerService timers;
    private RoomBroadcaster broadcaster;
    private ScoreRoundSubmissionService submissions;
    private YachtTurnActionService actions;

    @BeforeEach
    void setUp() {
        rounds = new RoundSynchronizationService(new InMemoryRoundStateStore());
        timers = mock(RoundTimerService.class);
        broadcaster = mock(RoomBroadcaster.class);
        submissions = mock(ScoreRoundSubmissionService.class);
        actions = new YachtTurnActionService(rounds, timers, broadcaster, submissions);
        rounds.initialize("room-a", 1, List.of("player-a", "player-b"));
    }

    @Test
    void rollChangesStateBroadcastsTheResultAndRestartsTheTimer() {
        DiceRollPayload payload = new DiceRollPayload(
                1,
                1,
                List.of(false, false, false, false, false)
        );

        var state = actions.roll("room-a", "player-a", payload, "roll-a");

        assertThat(state.activeRollCount()).isEqualTo(1);
        assertThat(state.activeDice()).hasSize(5).allMatch(die -> die >= 1 && die <= 6);
        verify(timers).start("room-a", state);

        ArgumentCaptor<WsEnvelope<?>> envelope = envelopeCaptor();
        verify(broadcaster).broadcast(org.mockito.ArgumentMatchers.eq("room-a"), envelope.capture());
        assertThat(envelope.getValue().type()).isEqualTo("game.yacht_dice.dice.broadcast");
        assertThat(envelope.getValue().roomId()).isEqualTo("room-a");
        assertThat(envelope.getValue().msgId()).isEqualTo("roll-a");
        assertThat(envelope.getValue().payload()).isInstanceOfSatisfying(
                DiceBroadcastPayload.class,
                broadcast -> {
                    assertThat(broadcast.playerId()).isEqualTo("player-a");
                    assertThat(broadcast.rollCount()).isEqualTo(1);
                    assertThat(broadcast.auto()).isFalse();
                }
        );
    }

    @Test
    void holdChangesStateAndBroadcastsWithoutRestartingTheTimer() {
        actions.roll("room-a", "player-a", new DiceRollPayload(
                1,
                1,
                List.of(false, false, false, false, false)
        ), "roll-a");
        clearInvocations(timers, broadcaster);
        DiceHoldPayload payload = new DiceHoldPayload(
                1,
                List.of(true, true, false, false, false)
        );

        var state = actions.hold("room-a", "player-a", payload, "hold-a");

        assertThat(state.activeHeld()).containsExactly(true, true, false, false, false);
        ArgumentCaptor<WsEnvelope<?>> envelope = envelopeCaptor();
        verify(broadcaster).broadcast(org.mockito.ArgumentMatchers.eq("room-a"), envelope.capture());
        assertThat(envelope.getValue().type()).isEqualTo("game.yacht_dice.dice.hold_changed");
        assertThat(envelope.getValue().msgId()).isEqualTo("hold-a");
        assertThat(envelope.getValue().payload()).isInstanceOfSatisfying(
                DiceHoldChangedPayload.class,
                broadcast -> assertThat(broadcast.held())
                        .containsExactly(true, true, false, false, false)
        );
        org.mockito.Mockito.verifyNoInteractions(timers);
    }

    @Test
    void submitScoreUsesTheSharedSubmissionAndTurnAdvancePath() {
        RoundSubmitPayload payload = new RoundSubmitPayload(
                1,
                List.of(1, 2, 3, 4, 5),
                "smallStraight"
        );
        ScoreRoundSubmissionResult result = mock(ScoreRoundSubmissionResult.class);
        when(submissions.submit("room-a", "player-a", payload)).thenReturn(result);

        ScoreRoundSubmissionResult actual =
                actions.submitScore("room-a", "player-a", payload, "submit-a");

        assertThat(actual).isSameAs(result);
        verify(timers).advanceTurn("room-a", result, "submit-a");
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static ArgumentCaptor<WsEnvelope<?>> envelopeCaptor() {
        return (ArgumentCaptor) ArgumentCaptor.forClass(WsEnvelope.class);
    }
}
