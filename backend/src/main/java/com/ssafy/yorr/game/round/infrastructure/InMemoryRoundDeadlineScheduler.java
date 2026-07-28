package com.ssafy.yorr.game.round.infrastructure;

import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class InMemoryRoundDeadlineScheduler implements RoundDeadlineScheduler {

    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "round-deadline");
        thread.setDaemon(true);
        return thread;
    });
    private final ConcurrentMap<String, ScheduledRound> scheduledRounds = new ConcurrentHashMap<>();
    private final AtomicLong generations = new AtomicLong();

    @Override
    public void schedule(String roomId, int roundNumber, Instant deadline, Runnable timeoutAction) {
        if (roomId == null || roomId.isBlank()) {
            throw new IllegalArgumentException("roomId must not be blank");
        }
        if (roundNumber < 1) {
            throw new IllegalArgumentException("roundNumber must be at least 1");
        }
        if (deadline == null || timeoutAction == null) {
            throw new IllegalArgumentException("deadline and timeoutAction are required");
        }

        long delayMillis = Math.max(0, Duration.between(Instant.now(), deadline).toMillis());
        long generation = generations.incrementAndGet();
        ScheduledFuture<?> future = executor.schedule(
                () -> runIfCurrent(roomId, roundNumber, generation, timeoutAction),
                delayMillis,
                TimeUnit.MILLISECONDS
        );
        ScheduledRound previous = scheduledRounds.put(
                roomId,
                new ScheduledRound(roundNumber, generation, future)
        );
        if (previous != null) {
            previous.future().cancel(false);
        }
    }

    @Override
    public void cancel(String roomId, int roundNumber) {
        scheduledRounds.computeIfPresent(roomId, (key, scheduled) -> {
            if (scheduled.roundNumber() != roundNumber) {
                return scheduled;
            }
            scheduled.future().cancel(false);
            return null;
        });
    }

    @Override
    public void cancelRoom(String roomId) {
        ScheduledRound scheduled = scheduledRounds.remove(roomId);
        if (scheduled != null) {
            scheduled.future().cancel(false);
        }
    }

    private void runIfCurrent(
            String roomId,
            int roundNumber,
            long generation,
            Runnable timeoutAction
    ) {
        AtomicBoolean current = new AtomicBoolean(false);
        scheduledRounds.computeIfPresent(roomId, (key, scheduled) -> {
            if (scheduled.roundNumber() == roundNumber && scheduled.generation() == generation) {
                current.set(true);
                return null;
            }
            return scheduled;
        });
        if (current.get()) {
            timeoutAction.run();
        }
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }

    private record ScheduledRound(int roundNumber, long generation, ScheduledFuture<?> future) {
    }
}
