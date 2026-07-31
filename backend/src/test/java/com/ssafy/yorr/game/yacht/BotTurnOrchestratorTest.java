package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.round.application.RoundStartedEvent;
import com.ssafy.yorr.game.round.domain.RoundState;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import static org.mockito.ArgumentMatchers.any;
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
        ScheduledExecutorService executor = mock(ScheduledExecutorService.class);
        when(executor.schedule(any(Runnable.class), eq(0L), eq(TimeUnit.MILLISECONDS)))
                .thenReturn(mock(ScheduledFuture.class));
        BotTurnOrchestrator orchestrator =
                new BotTurnOrchestrator(coordinator, executor, Duration.ZERO);
        RoundStartedEvent first = new RoundStartedEvent(
                "room-a",
                RoundState.start(1, List.of("bot-a", "player-a"))
        );
        RoundStartedEvent latest = new RoundStartedEvent(
                "room-a",
                RoundState.start(2, List.of("bot-a", "player-a"))
        );

        orchestrator.onRoundStarted(first);
        orchestrator.onRoundStarted(latest);

        ArgumentCaptor<Runnable> tasks = ArgumentCaptor.forClass(Runnable.class);
        verify(executor, times(2)).schedule(
                tasks.capture(),
                eq(0L),
                eq(TimeUnit.MILLISECONDS)
        );
        tasks.getAllValues().get(0).run();
        verify(coordinator, never()).playIfCurrent(first);
        tasks.getAllValues().get(1).run();
        verify(coordinator).playIfCurrent(latest);
    }
}
