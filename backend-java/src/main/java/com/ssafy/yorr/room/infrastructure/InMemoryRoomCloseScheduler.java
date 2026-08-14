package com.ssafy.yorr.room.infrastructure;

import com.ssafy.yorr.room.port.RoomCloseScheduler;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * 단일 인스턴스 전제 예약기. 분산이 필요해지면 이 어댑터만 갈아끼운다
 * ({@link com.ssafy.yorr.game.round.infrastructure.InMemoryRoundDeadlineScheduler}와 같은 이유).
 */
@Component
public class InMemoryRoomCloseScheduler implements RoomCloseScheduler {

    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "room-close");
        thread.setDaemon(true);
        return thread;
    });
    private final ConcurrentMap<String, ScheduledFuture<?>> pending = new ConcurrentHashMap<>();

    @Override
    public void schedule(String roomId, Duration delay, Runnable closeTask) {
        if (roomId == null || roomId.isBlank()) {
            throw new IllegalArgumentException("roomId must not be blank");
        }
        if (delay == null || closeTask == null) {
            throw new IllegalArgumentException("delay and closeTask are required");
        }

        ScheduledFuture<?> future = executor.schedule(
                () -> {
                    // 자기 예약만 지운다. 그 사이 새 예약이 들어왔으면 그쪽을 살려둬야 한다.
                    pending.remove(roomId);
                    closeTask.run();
                },
                Math.max(0, delay.toMillis()),
                TimeUnit.MILLISECONDS
        );
        ScheduledFuture<?> previous = pending.put(roomId, future);
        if (previous != null) {
            previous.cancel(false);
        }
    }

    @Override
    public boolean cancel(String roomId) {
        ScheduledFuture<?> future = pending.remove(roomId);
        if (future == null) {
            return false;
        }
        future.cancel(false);
        return true;
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
