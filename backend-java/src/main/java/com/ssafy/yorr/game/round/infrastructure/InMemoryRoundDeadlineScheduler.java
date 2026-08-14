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

    private final ScheduledExecutorService executor;
    private final ConcurrentMap<String, ScheduledRound> scheduledRounds = new ConcurrentHashMap<>();
    private final AtomicLong generations = new AtomicLong();

    public InMemoryRoundDeadlineScheduler() {
        this(Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "round-deadline");
            thread.setDaemon(true);
            return thread;
        }));
    }

    /** 예약과 슬롯 등록의 순서를 검증하려면 즉시 실행 executor 를 넣어야 한다 (테스트 전용 seam). */
    InMemoryRoundDeadlineScheduler(ScheduledExecutorService executor) {
        this.executor = executor;
    }

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

        // 슬롯을 예약보다 먼저 잡는다. 마감이 이미 지났으면(delayMillis == 0) 워커가 아래
        // executor.schedule 직후 바로 실행되는데, 그때 이 세대가 맵에 없으면 runIfCurrent 가
        // "내 차례가 아니다"로 보고 조용히 스킵한다 → 그 방은 다음 schedule 까지 타임아웃이
        // 영영 안 온다(탁구: 서브·실점이 멈추고 공이 화면에 얼어붙음).
        ScheduledRound previous = scheduledRounds.put(
                roomId,
                new ScheduledRound(roundNumber, generation, null)
        );
        cancelQuietly(previous);

        ScheduledFuture<?> future = executor.schedule(
                () -> runIfCurrent(roomId, roundNumber, generation, timeoutAction),
                delayMillis,
                TimeUnit.MILLISECONDS
        );
        // 이미 실행돼 슬롯이 비었으면 붙일 곳이 없다 — computeIfPresent 가 no-op 이다.
        scheduledRounds.computeIfPresent(roomId, (key, scheduled) ->
                scheduled.generation() == generation
                        ? new ScheduledRound(roundNumber, generation, future)
                        : scheduled);
    }

    @Override
    public void cancel(String roomId, int roundNumber) {
        scheduledRounds.computeIfPresent(roomId, (key, scheduled) -> {
            if (scheduled.roundNumber() != roundNumber) {
                return scheduled;
            }
            cancelQuietly(scheduled);
            return null;
        });
    }

    @Override
    public void cancelRoom(String roomId) {
        cancelQuietly(scheduledRounds.remove(roomId));
    }

    /** future 는 슬롯을 먼저 잡는 구간에서만 잠깐 null 이다 (schedule 주석 참고). */
    private static void cancelQuietly(ScheduledRound scheduled) {
        if (scheduled != null && scheduled.future() != null) {
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
