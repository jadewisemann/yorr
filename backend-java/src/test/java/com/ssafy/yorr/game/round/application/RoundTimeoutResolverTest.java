package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.dto.ScoreConfirmationCommand;
import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.DiceBroadcastPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.ScoreUpdatePayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RoundTimeoutResolverTest {

    private static final Instant NOW = Instant.parse("2026-07-26T00:00:00Z");
    private static final List<Boolean> NO_HELD = List.of(false, false, false, false, false);

    private InMemoryRoundStateStore stateStore;
    /** resolver가 쓰는 서비스. 자동 굴림은 항상 1이 나온다. */
    private RoundSynchronizationService synchronizationService;
    /** 플레이어가 직접 굴린 것처럼 상태를 만들 때 쓴다. 항상 6이 나온다 — 자동 굴림과 구분된다. */
    private RoundSynchronizationService playerRolls;
    private ScoreConfirmationService scoreConfirmationService;
    private RoomService roomService;
    private RoomBroadcaster broadcaster;
    private RoundTimeoutResolver resolver;

    @BeforeEach
    void setUp() {
        stateStore = new InMemoryRoundStateStore();
        synchronizationService = new RoundSynchronizationService(stateStore, () -> 1);
        playerRolls = new RoundSynchronizationService(stateStore, () -> 6);
        scoreConfirmationService = mock(ScoreConfirmationService.class);
        roomService = mock(RoomService.class);
        broadcaster = mock(RoomBroadcaster.class);
        when(roomService.getSnapshot("room-a")).thenReturn(new RoomSnapshot(
                "room-a", "game-a", "player-a", RoomPhase.PLAYING, 2, List.of()));
        when(scoreConfirmationService.openCategories("game-a", "player-a"))
                .thenReturn(List.of(ScoreCategory.CHOICE, ScoreCategory.YACHT));
        when(scoreConfirmationService.confirm(any()))
                .thenAnswer(invocation -> confirmed(invocation.getArgument(0)));
        resolver = new RoundTimeoutResolver(
                synchronizationService,
                new ScoreRoundSubmissionService(
                        synchronizationService,
                        scoreConfirmationService,
                        roomService
                ),
                scoreConfirmationService,
                roomService,
                broadcaster,
                Clock.fixed(NOW, ZoneOffset.UTC),
                // 항상 마지막 후보를 고른다 — 랜덤 선택을 결정적으로 만든다.
                bound -> bound - 1
        );
    }

    @Test
    void rollsOnceForThePlayerWhoRanOutOfTimeAndKeepsTheTurn() {
        synchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));

        RoundTimeoutResolution resolution = resolver.resolve("room-a", 1, "player-a");

        assertThat(resolution.kind()).isEqualTo(RoundTimeoutResolution.Kind.AUTO_ROLLED);
        assertThat(stateStore.findByRoomId("room-a")).hasValueSatisfying(state -> {
            assertThat(state.activeRollCount()).isEqualTo(1);
            assertThat(state.activePlayerId()).isEqualTo("player-a");
            assertThat(state.activeDice()).containsExactly(1, 1, 1, 1, 1);
        });
        assertThat(broadcastPayload(DiceBroadcastPayload.class)).isEqualTo(new DiceBroadcastPayload(
                "player-a", 1, 1, List.of(1, 1, 1, 1, 1), NO_HELD, true));
        verify(scoreConfirmationService, never()).confirm(any());
    }

    @Test
    void keepsTheDiceThePlayerHeldOnTheLastRoll() {
        synchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        playerRolls.recordRoll("room-a", "player-a", new DiceRollPayload(1, 1, NO_HELD));
        // 두 번째 굴림에서 1·2번 주사위를 킵했다고 알린 뒤 시간이 지난 상황.
        playerRolls.recordRoll("room-a", "player-a",
                new DiceRollPayload(1, 2, List.of(true, true, false, false, false)));

        resolver.resolve("room-a", 1, "player-a");

        assertThat(stateStore.findByRoomId("room-a")).hasValueSatisfying(state -> {
            assertThat(state.activeRollCount()).isEqualTo(3);
            // 킵한 두 칸은 6으로 남고, 나머지 세 칸만 다시 굴렸다(1).
            assertThat(state.activeDice()).containsExactly(6, 6, 1, 1, 1);
            assertThat(state.activeHeld()).containsExactly(true, true, false, false, false);
        });
    }

    @Test
    void recordsARemainingCategoryAndPassesTheTurnWhenNoRollsAreLeft() {
        synchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        rollThreeTimes();

        RoundTimeoutResolution resolution = resolver.resolve("room-a", 1, "player-a");

        assertThat(resolution.kind()).isEqualTo(RoundTimeoutResolution.Kind.ADVANCED);
        assertThat(resolution.advanced().state().activePlayerId()).isEqualTo("player-b");
        ArgumentCaptor<ScoreConfirmationCommand> command =
                ArgumentCaptor.forClass(ScoreConfirmationCommand.class);
        verify(scoreConfirmationService).confirm(command.capture());
        // 남은 후보(choice·yacht) 중에서 골랐다 — 이미 기록한 칸을 덮어쓰지 않는다.
        assertThat(command.getValue().category()).isEqualTo("yacht");
        assertThat(command.getValue().dice()).containsExactly(6, 6, 6, 6, 6);
        assertThat(broadcastPayload(ScoreUpdatePayload.class).playerId()).isEqualTo("player-a");
    }

    @Test
    void doesNothingWhenThePlayerAlreadySubmittedDuringTheGracePeriod() {
        synchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        rollThreeTimes();
        synchronizationService.submit("room-a", "player-a",
                new RoundSubmitPayload(1, List.of(6, 6, 6, 6, 6), "yacht"));

        RoundTimeoutResolution resolution = resolver.resolve("room-a", 1, "player-a");

        assertThat(resolution.kind()).isEqualTo(RoundTimeoutResolution.Kind.STALE);
        verify(broadcaster, never()).broadcast(eq("room-a"), any());
    }

    @Test
    void stillPassesTheTurnWhenTheScoreStoreFails() {
        synchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        rollThreeTimes();
        doThrow(new ScoreConfirmationException(
                ScoreConfirmationException.Reason.STORE_FAILURE, "redis unavailable"))
                .when(scoreConfirmationService).confirm(any());

        RoundTimeoutResolution resolution = resolver.resolve("room-a", 1, "player-a");

        // 점수를 남기지 못해도 턴은 멈추지 않는다 — 게임이 여기서 굳으면 아무도 진행할 수 없다.
        assertThat(resolution.kind()).isEqualTo(RoundTimeoutResolution.Kind.ADVANCED);
        assertThat(resolution.advanced().state().activePlayerId()).isEqualTo("player-b");
    }

    private void rollThreeTimes() {
        for (int rollCount = 1; rollCount <= 3; rollCount++) {
            playerRolls.recordRoll(
                    "room-a", "player-a", new DiceRollPayload(1, rollCount, NO_HELD));
        }
    }

    private <T> T broadcastPayload(Class<T> payloadType) {
        ArgumentCaptor<WsEnvelope<?>> captor = ArgumentCaptor.forClass(WsEnvelope.class);
        verify(broadcaster, times(1)).broadcast(eq("room-a"), captor.capture());
        return payloadType.cast(captor.getValue().payload());
    }

    private static ScoreConfirmationResult confirmed(ScoreConfirmationCommand command) {
        return new ScoreConfirmationResult(
                command.gameId(),
                command.playerId(),
                command.roundNumber(),
                command.category(),
                50,
                new ScoreBoard(Map.of(command.category(), 50), 0, 0, 50)
        );
    }
}
