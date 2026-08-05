package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.round.application.RoundStartedEvent;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.DiceThrownPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BotTurnOrchestratorTest {

    @Test
    void onlyExecutesTheLatestScheduledStateForARoom() {
        YachtBotTurnCoordinator coordinator = mock(YachtBotTurnCoordinator.class);
        RoomBroadcaster broadcaster = mock(RoomBroadcaster.class);
        ScheduledExecutorService executor = mock(ScheduledExecutorService.class);
        when(executor.schedule(any(Runnable.class), eq(0L), eq(TimeUnit.MILLISECONDS)))
                .thenReturn(mock(ScheduledFuture.class));
        BotTurnOrchestrator orchestrator =
                new BotTurnOrchestrator(coordinator, broadcaster, executor, Duration.ZERO);
        RoundStartedEvent first = new RoundStartedEvent(
                "room-a",
                RoundState.start(1, List.of("bot-a", "player-a"))
        );
        RoundStartedEvent latest = new RoundStartedEvent(
                "room-a",
                RoundState.start(2, List.of("bot-a", "player-a"))
        );
        when(coordinator.executeIfCurrent(latest))
                .thenReturn(YachtBotTurnCoordinator.BotTurnStep.ignored());

        orchestrator.onRoundStarted(first);
        orchestrator.onRoundStarted(latest);

        ArgumentCaptor<Runnable> tasks = ArgumentCaptor.forClass(Runnable.class);
        verify(executor, times(2)).schedule(
                tasks.capture(),
                eq(0L),
                eq(TimeUnit.MILLISECONDS)
        );
        tasks.getAllValues().get(0).run();
        verify(coordinator, never()).executeIfCurrent(first);
        tasks.getAllValues().get(1).run();
        verify(coordinator).executeIfCurrent(latest);
    }

    @Test
    void waitsAfterAKeepSelectionBeforeContinuingTheSameTurn() {
        YachtBotTurnCoordinator coordinator = mock(YachtBotTurnCoordinator.class);
        RoomBroadcaster broadcaster = mock(RoomBroadcaster.class);
        ScheduledExecutorService executor = mock(ScheduledExecutorService.class);
        when(executor.schedule(any(Runnable.class), anyLong(), eq(TimeUnit.MILLISECONDS)))
                .thenReturn(mock(ScheduledFuture.class));
        BotTurnOrchestrator orchestrator =
                new BotTurnOrchestrator(coordinator, broadcaster, executor, Duration.ZERO);
        RoundState started = RoundState.start(1, List.of("bot-a", "player-a"));
        RoundState held = started
                .recordRoll("bot-a", 1, 1, List.of(false, false, false, false, false),
                        List.of(6, 6, 2, 3, 4))
                .recordHold("bot-a", 1, List.of(true, true, false, false, false));
        RoundStartedEvent event = new RoundStartedEvent("room-a", started);
        when(coordinator.executeIfCurrent(event))
                .thenReturn(YachtBotTurnCoordinator.BotTurnStep.continueAfterObservation(held));

        orchestrator.onRoundStarted(event);

        ArgumentCaptor<Runnable> tasks = ArgumentCaptor.forClass(Runnable.class);
        verify(executor).schedule(tasks.capture(), eq(0L), eq(TimeUnit.MILLISECONDS));
        tasks.getValue().run();
        verify(executor, times(2))
                .schedule(tasks.capture(), eq(0L), eq(TimeUnit.MILLISECONDS));
    }

    @Test
    void announcesTheThrowAfterABotRollSoRemoteDiceCanBeReleased() {
        YachtBotTurnCoordinator coordinator = mock(YachtBotTurnCoordinator.class);
        RoomBroadcaster broadcaster = mock(RoomBroadcaster.class);
        ScheduledExecutorService executor = mock(ScheduledExecutorService.class);
        when(executor.schedule(any(Runnable.class), anyLong(), eq(TimeUnit.MILLISECONDS)))
                .thenReturn(mock(ScheduledFuture.class));
        BotTurnOrchestrator orchestrator = new BotTurnOrchestrator(
                coordinator,
                broadcaster,
                executor,
                Duration.ZERO
        );
        RoundState started = RoundState.start(1, List.of("bot-a", "player-a"));
        RoundState rolled = started.recordRoll(
                "bot-a",
                1,
                1,
                List.of(false, false, false, false, false),
                List.of(6, 6, 2, 3, 4)
        );
        RoundStartedEvent event = new RoundStartedEvent("room-a", started);
        when(coordinator.executeIfCurrent(event))
                .thenReturn(YachtBotTurnCoordinator.BotTurnStep.completed(rolled));

        orchestrator.onRoundStarted(event);

        ArgumentCaptor<Runnable> tasks = ArgumentCaptor.forClass(Runnable.class);
        verify(executor).schedule(tasks.capture(), eq(0L), eq(TimeUnit.MILLISECONDS));
        tasks.getValue().run();
        verify(executor).schedule(
                tasks.capture(),
                eq(BotTurnOrchestrator.THROW_DELAY.toMillis()),
                eq(TimeUnit.MILLISECONDS)
        );
        tasks.getValue().run();

        @SuppressWarnings({"rawtypes", "unchecked"})
        ArgumentCaptor<WsEnvelope<?>> envelope =
                (ArgumentCaptor) ArgumentCaptor.forClass(WsEnvelope.class);
        verify(broadcaster).broadcast(eq("room-a"), envelope.capture());
        assertThat(envelope.getValue().type()).isEqualTo("game.yacht_dice.dice.thrown");
        assertThat(envelope.getValue().payload()).isInstanceOfSatisfying(
                DiceThrownPayload.class,
                payload -> {
                    assertThat(payload.playerId()).isEqualTo("bot-a");
                    assertThat(payload.roundNumber()).isEqualTo(1);
                    assertThat(payload.rollCount()).isEqualTo(1);
                }
        );
    }
}
