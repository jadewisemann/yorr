package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.round.application.RoundStartedEvent;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import com.ssafy.yorr.room.dto.BotDifficulty;
import com.ssafy.yorr.room.dto.ParticipantKind;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomPlayerSnapshot;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class YachtBotTurnCoordinatorTest {

    private static final List<Boolean> NO_HELD =
            List.of(false, false, false, false, false);

    private RoundSynchronizationService rounds;
    private YachtTurnActionService actions;
    private RoomService rooms;
    private ScoreConfirmationService scores;
    private YachtBotTurnCoordinator coordinator;

    @BeforeEach
    void setUp() {
        rounds = mock(RoundSynchronizationService.class);
        actions = mock(YachtTurnActionService.class);
        rooms = mock(RoomService.class);
        scores = mock(ScoreConfirmationService.class);
        coordinator = new YachtBotTurnCoordinator(
                rounds,
                actions,
                new LocalYachtBotStrategy(),
                rooms,
                scores
        );
        when(rooms.getSnapshot("room-a")).thenReturn(roomWithBot());
    }

    @Test
    void startsTheCurrentBotsTurnWithAServerGeneratedRoll() {
        RoundState state = RoundState.start(1, List.of("bot-a", "player-a"));
        when(rounds.findByRoomId("room-a")).thenReturn(Optional.of(state));

        assertThat(coordinator.playIfCurrent(new RoundStartedEvent("room-a", state))).isTrue();

        ArgumentCaptor<DiceRollPayload> payload = ArgumentCaptor.forClass(DiceRollPayload.class);
        verify(actions).roll(eq("room-a"), eq("bot-a"), payload.capture(), eq(null));
        assertThat(payload.getValue().roundNumber()).isEqualTo(1);
        assertThat(payload.getValue().rollCount()).isEqualTo(1);
        assertThat(payload.getValue().held()).containsExactlyElementsOf(NO_HELD);
    }

    @Test
    void discardsAnActionWhenTheRoundStateChangedAfterScheduling() {
        RoundState scheduled = RoundState.start(1, List.of("bot-a", "player-a"));
        RoundState changed = scheduled.recordRoll(
                "bot-a",
                1,
                1,
                NO_HELD,
                List.of(1, 2, 3, 4, 5)
        );
        when(rounds.findByRoomId("room-a")).thenReturn(Optional.of(changed));

        assertThat(coordinator.playIfCurrent(new RoundStartedEvent("room-a", scheduled))).isFalse();

        verify(actions, never()).roll(any(), any(), any(), any());
        verify(actions, never()).hold(any(), any(), any(), any());
        verify(actions, never()).submitScore(any(), any(), any(), any());
    }

    @Test
    void submitsTheBestOpenCategoryAfterTheThirdRoll() {
        RoundState state = RoundState.start(1, List.of("bot-a", "player-a"));
        state = state.recordRoll("bot-a", 1, 1, NO_HELD, List.of(6, 6, 6, 6, 6));
        state = state.recordRoll("bot-a", 1, 2, NO_HELD, List.of(6, 6, 6, 6, 6));
        state = state.recordRoll("bot-a", 1, 3, NO_HELD, List.of(6, 6, 6, 6, 6));
        when(rounds.findByRoomId("room-a")).thenReturn(Optional.of(state));
        when(scores.openCategories("game-a", "bot-a"))
                .thenReturn(List.of(ScoreCategory.SIXES, ScoreCategory.YACHT));

        assertThat(coordinator.playIfCurrent(new RoundStartedEvent("room-a", state))).isTrue();

        ArgumentCaptor<RoundSubmitPayload> payload =
                ArgumentCaptor.forClass(RoundSubmitPayload.class);
        verify(actions).submitScore(
                eq("room-a"),
                eq("bot-a"),
                payload.capture(),
                eq(null)
        );
        assertThat(payload.getValue().category()).isEqualTo("yacht");
        assertThat(payload.getValue().dice()).containsExactly(6, 6, 6, 6, 6);
    }

    @Test
    void ignoresAHumanTurn() {
        RoundState state = RoundState.start(1, List.of("player-a", "bot-a"));
        when(rounds.findByRoomId("room-a")).thenReturn(Optional.of(state));

        assertThat(coordinator.playIfCurrent(new RoundStartedEvent("room-a", state))).isFalse();

        verify(actions, never()).roll(any(), any(), any(), any());
    }

    private static RoomSnapshot roomWithBot() {
        return new RoomSnapshot(
                "room-a",
                YachtDiceGameModule.CODE,
                "game-a",
                "player-a",
                RoomPhase.PLAYING,
                6,
                List.of(
                        new RoomPlayerSnapshot(
                                "player-a",
                                "Player A",
                                0,
                                ParticipantKind.HUMAN,
                                null
                        ),
                        new RoomPlayerSnapshot(
                                "bot-a",
                                "Bot A",
                                0,
                                ParticipantKind.BOT,
                                BotDifficulty.HARD
                        )
                )
        );
    }
}
