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

    static final Duration ACTION_DELAY = Duration.ofMillis(500);

    private static final Logger log = LoggerFactory.getLogger(BotTurnOrchestrator.class);

    private final YachtBotTurnCoordinator coordinator;
    private final ScheduledExecutorService executor;
    private final Duration actionDelay;
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
                ACTION_DELAY
        );
    }

    BotTurnOrchestrator(
            YachtBotTurnCoordinator coordinator,
            ScheduledExecutorService executor,
            Duration actionDelay
    ) {
        this.coordinator = coordinator;
        this.executor = executor;
        this.actionDelay = actionDelay;
    }

    @EventListener
    public void onRoundStarted(RoundStartedEvent event) {
        long generation = sequence.incrementAndGet();
        roomGenerations.put(event.roomId(), generation);
        executor.schedule(
                () -> executeIfLatest(event, generation),
                actionDelay.toMillis(),
                TimeUnit.MILLISECONDS
        );
    }

    private void executeIfLatest(RoundStartedEvent event, long generation) {
        if (!Long.valueOf(generation).equals(roomGenerations.get(event.roomId()))) {
            return;
        }
        try {
            coordinator.playIfCurrent(event);
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

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
