package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.round.application.RoundStartedEvent;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class BotTurnOrchestrator {

    static final Duration TURN_START_DELAY = Duration.ofMillis(1_200);
    static final Duration ROLL_RESULT_DELAY = Duration.ofMillis(6_500);
    static final Duration HOLD_SELECTION_DELAY = Duration.ofMillis(1_500);

    private static final Logger log = LoggerFactory.getLogger(BotTurnOrchestrator.class);

    private final YachtBotTurnCoordinator coordinator;
    private final ScheduledExecutorService executor;
    private final Duration turnStartDelay;
    private final Duration rollResultDelay;
    private final Duration holdSelectionDelay;
    private final AtomicLong sequence = new AtomicLong();
    private final Map<String, Long> roomGenerations = new ConcurrentHashMap<>();

    @Autowired
    public BotTurnOrchestrator(YachtBotTurnCoordinator coordinator) {
        this(
                coordinator,
                Executors.newScheduledThreadPool(2, runnable -> {
                    Thread thread = new Thread(runnable, "yacht-bot-turn");
                    thread.setDaemon(true);
                    return thread;
                }),
                TURN_START_DELAY,
                ROLL_RESULT_DELAY,
                HOLD_SELECTION_DELAY
        );
    }

    BotTurnOrchestrator(
            YachtBotTurnCoordinator coordinator,
            ScheduledExecutorService executor,
            Duration actionDelay
    ) {
        this(coordinator, executor, actionDelay, actionDelay, actionDelay);
    }

    BotTurnOrchestrator(
            YachtBotTurnCoordinator coordinator,
            ScheduledExecutorService executor,
            Duration turnStartDelay,
            Duration rollResultDelay,
            Duration holdSelectionDelay
    ) {
        this.coordinator = coordinator;
        this.executor = executor;
        this.turnStartDelay = turnStartDelay;
        this.rollResultDelay = rollResultDelay;
        this.holdSelectionDelay = holdSelectionDelay;
    }

    @EventListener
    public void onRoundStarted(RoundStartedEvent event) {
        long generation = sequence.incrementAndGet();
        roomGenerations.put(event.roomId(), generation);
        schedule(event, generation, delayFor(event.state()));
    }

    private void executeIfLatest(RoundStartedEvent event, long generation) {
        if (!Long.valueOf(generation).equals(roomGenerations.get(event.roomId()))) {
            return;
        }
        try {
            YachtBotTurnCoordinator.BotTurnStep step = coordinator.executeIfCurrent(event);
            if (step.continueAfterObservation()
                    && Long.valueOf(generation).equals(roomGenerations.get(event.roomId()))) {
                schedule(
                        new RoundStartedEvent(event.roomId(), step.state()),
                        generation,
                        holdSelectionDelay
                );
            }
        } catch (RuntimeException exception) {
            log.warn(
                    "AI 봇 행동 실행에 실패했습니다. 타이머 fallback으로 진행합니다: room={} round={} player={}",
                    event.roomId(),
                    event.state().roundNumber(),
                    event.state().activePlayerId(),
                    exception
            );
        }
    }

    private Duration delayFor(com.ssafy.yorr.game.round.domain.RoundState state) {
        return state.activeRollCount() == 0 ? turnStartDelay : rollResultDelay;
    }

    private void schedule(RoundStartedEvent event, long generation, Duration delay) {
        executor.schedule(
                () -> executeIfLatest(event, generation),
                delay.toMillis(),
                TimeUnit.MILLISECONDS
        );
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
