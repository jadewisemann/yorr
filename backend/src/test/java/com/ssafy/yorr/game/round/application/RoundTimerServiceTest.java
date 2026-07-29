package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.RoundEndPayload;
import com.ssafy.yorr.ws.dto.RoundStartPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RoundTimerServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-26T00:00:00Z");

    private FakeRoundDeadlineScheduler scheduler;
    private RoomBroadcaster broadcaster;
    private RoundTimeoutResolver timeoutResolver;
    private RoundTimerService timerService;

    @BeforeEach
    void setUp() {
        scheduler = new FakeRoundDeadlineScheduler();
        broadcaster = mock(RoomBroadcaster.class);
        timeoutResolver = mock(RoundTimeoutResolver.class);
        timerService = new RoundTimerService(
                timeoutResolver,
                scheduler,
                broadcaster,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }

    @Test
    void broadcastsRoundStartWithServerDeadline() {
        Instant deadline = timerService.start("room-a", 1, "player-a");

        assertThat(deadline).isEqualTo(NOW.plusSeconds(25));
        // 마감 직전에 떠난 round.submit이 도착할 틈을 주고 나서 강제 진행한다.
        assertThat(scheduler.deadline).isEqualTo(deadline.plus(RoundTimerService.EXPIRY_GRACE));
        WsEnvelope<?> message = capturedBroadcast();
        assertThat(message.type()).isEqualTo("round.start");
        assertThat(message.ts()).isEqualTo(NOW.toEpochMilli());
        assertThat(message.roomId()).isEqualTo("room-a");
        assertThat(message.msgId()).isNull();
        assertThat(message.payload()).isEqualTo(
                new RoundStartPayload(1, deadline.toEpochMilli(), "player-a")
        );
    }

    @Test
    void givesTheSameTurnFreshTimeAfterAnAutomaticRoll() {
        when(timeoutResolver.resolve("room-a", 1, "player-a"))
                .thenReturn(RoundTimeoutResolution.autoRolled());
        timerService.start("room-a", 1, "player-a");
        reset(broadcaster);

        scheduler.fire();

        // 턴 주인은 그대로다 — 남은 굴림을 직접 쓸 시간을 다시 준다.
        assertThat(capturedBroadcast().payload()).isEqualTo(
                new RoundStartPayload(1, NOW.plusSeconds(25).toEpochMilli(), "player-a")
        );
        assertThat(scheduler.timeoutAction).isNotNull();
    }

    @Test
    void startsTheNextPlayersTurnWhenTheTimeoutRecordedAScore() {
        RoundState nextTurn = RoundState.start(1, List.of("player-a", "player-b"))
                .submit(new RoundSubmission(
                        "player-a", 1, List.of(1, 2, 3, 4, 5), "smallStraight"))
                .state();
        when(timeoutResolver.resolve("room-a", 1, "player-a"))
                .thenReturn(RoundTimeoutResolution.advanced(new RoundSubmissionResult(nextTurn, null)));
        timerService.start("room-a", 1, "player-a");
        reset(broadcaster);

        scheduler.fire();

        assertThat(capturedBroadcast().payload()).isEqualTo(
                new RoundStartPayload(1, NOW.plusSeconds(25).toEpochMilli(), "player-b")
        );
    }

    @Test
    void staleTimeoutBroadcastsNothing() {
        when(timeoutResolver.resolve("room-a", 1, "player-a"))
                .thenReturn(RoundTimeoutResolution.stale());
        timerService.start("room-a", 1, "player-a");
        reset(broadcaster);

        scheduler.fire();

        verify(broadcaster, never()).broadcast(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any()
        );
    }

    @Test
    void announcesRoundEndBeforeTheNextRoundStarts() {
        RoundSubmissionResult completed = RoundState.start(1, List.of("player-a"))
                .submit(new RoundSubmission(
                        "player-a", 1, List.of(1, 2, 3, 4, 5), "smallStraight"));
        when(timeoutResolver.resolve("room-a", 1, "player-a"))
                .thenReturn(RoundTimeoutResolution.advanced(completed));
        timerService.start("room-a", 1, "player-a");
        reset(broadcaster);

        scheduler.fire();

        ArgumentCaptor<WsEnvelope<?>> captor = ArgumentCaptor.forClass(WsEnvelope.class);
        verify(broadcaster, org.mockito.Mockito.times(2))
                .broadcast(org.mockito.ArgumentMatchers.eq("room-a"), captor.capture());
        assertThat(captor.getAllValues().get(0).payload())
                .isEqualTo(new RoundEndPayload(1, List.of("player-a")));
        assertThat(captor.getAllValues().get(1).type()).isEqualTo("round.start");
    }

    private WsEnvelope<?> capturedBroadcast() {
        ArgumentCaptor<WsEnvelope<?>> captor = ArgumentCaptor.forClass(WsEnvelope.class);
        verify(broadcaster).broadcast(org.mockito.ArgumentMatchers.eq("room-a"), captor.capture());
        return captor.getValue();
    }

    private static class FakeRoundDeadlineScheduler implements RoundDeadlineScheduler {

        private Instant deadline;
        private Runnable timeoutAction;

        @Override
        public void schedule(String roomId, int roundNumber, Instant deadline, Runnable timeoutAction) {
            this.deadline = deadline;
            this.timeoutAction = timeoutAction;
        }

        @Override
        public void cancel(String roomId, int roundNumber) {
            timeoutAction = null;
        }

        @Override
        public void cancelRoom(String roomId) {
            timeoutAction = null;
        }

        void fire() {
            Runnable action = timeoutAction;
            timeoutAction = null;
            action.run();
        }
    }
}
