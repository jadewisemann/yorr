package com.ssafy.yorr.game.round.infrastructure;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class InMemoryRoundDeadlineSchedulerTest {

    /**
     * 마감이 이미 지났으면 delay 가 0 이라 워커가 schedule() 의 맵 갱신보다 먼저 깨어날 수 있다.
     * 슬롯을 나중에 잡으면 그 실행이 "내 차례가 아니다"로 조용히 버려지고, 그 방은 다음
     * schedule 까지 타임아웃이 영영 안 온다 — 탁구에서 서브가 안 나가고 공이 얼어붙던 원인.
     * 즉시 실행 executor 가 그 최악의 순서를 그대로 재현한다.
     */
    @Test
    void runsTimeoutEvenWhenTheWorkerFiresBeforeTheSlotIsRegistered() {
        AtomicInteger fired = new AtomicInteger();
        InMemoryRoundDeadlineScheduler scheduler = new InMemoryRoundDeadlineScheduler(inlineExecutor());

        scheduler.schedule("room", 1, Instant.now().minusMillis(1), fired::incrementAndGet);

        assertThat(fired.get()).isEqualTo(1);
    }

    /** 같은 방을 다시 예약하면 앞의 예약은 무효다 — 세대가 바뀌었으므로 옛 실행은 무시된다. */
    @Test
    void supersedesThePreviousScheduleForTheSameRoom() {
        AtomicInteger stale = new AtomicInteger();
        AtomicInteger fresh = new AtomicInteger();
        Runnable[] pending = new Runnable[1];
        ScheduledExecutorService deferred = mock(ScheduledExecutorService.class);
        when(deferred.schedule(any(Runnable.class), anyLong(), any())).thenAnswer(invocation -> {
            pending[0] = invocation.getArgument(0, Runnable.class);
            return mock(ScheduledFuture.class);
        });
        InMemoryRoundDeadlineScheduler scheduler = new InMemoryRoundDeadlineScheduler(deferred);

        scheduler.schedule("room", 1, Instant.now().plusSeconds(10), stale::incrementAndGet);
        Runnable staleTask = pending[0];
        scheduler.schedule("room", 2, Instant.now().plusSeconds(10), fresh::incrementAndGet);

        staleTask.run();
        pending[0].run();

        assertThat(stale.get()).isZero();
        assertThat(fresh.get()).isEqualTo(1);
    }

    /** 예약한 작업을 실행 전에 취소하면 아무것도 실행되지 않는다. */
    @Test
    void cancelRoomDropsThePendingTimeout() {
        AtomicInteger fired = new AtomicInteger();
        Runnable[] pending = new Runnable[1];
        ScheduledExecutorService deferred = mock(ScheduledExecutorService.class);
        when(deferred.schedule(any(Runnable.class), anyLong(), any())).thenAnswer(invocation -> {
            pending[0] = invocation.getArgument(0, Runnable.class);
            return mock(ScheduledFuture.class);
        });
        InMemoryRoundDeadlineScheduler scheduler = new InMemoryRoundDeadlineScheduler(deferred);

        scheduler.schedule("room", 1, Instant.now().plusSeconds(10), fired::incrementAndGet);
        scheduler.cancelRoom("room");
        pending[0].run();

        assertThat(fired.get()).isZero();
    }

    /** schedule() 이 반환하기 전에 작업을 실행해 버리는 executor — 최악의 순서 재현용. */
    private static ScheduledExecutorService inlineExecutor() {
        ScheduledExecutorService executor = mock(ScheduledExecutorService.class);
        when(executor.schedule(any(Runnable.class), anyLong(), any())).thenAnswer(invocation -> {
            invocation.getArgument(0, Runnable.class).run();
            return mock(ScheduledFuture.class);
        });
        return executor;
    }
}
