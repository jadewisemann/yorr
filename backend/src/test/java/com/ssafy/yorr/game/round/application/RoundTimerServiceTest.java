package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.RoundEndPayload;
import com.ssafy.yorr.ws.dto.RoundStartPayload;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
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

class RoundTimerServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-26T00:00:00Z");

    private InMemoryRoundStateStore stateStore;
    private RoundSynchronizationService synchronizationService;
    private FakeRoundDeadlineScheduler scheduler;
    private RoomBroadcaster broadcaster;
    private RoundTimerService timerService;

    @BeforeEach
    void setUp() {
        stateStore = new InMemoryRoundStateStore();
        synchronizationService = new RoundSynchronizationService(stateStore);
        scheduler = new FakeRoundDeadlineScheduler();
        broadcaster = mock(RoomBroadcaster.class);
        timerService = new RoundTimerService(
                synchronizationService,
                scheduler,
                broadcaster,
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }

    @Test
    void broadcastsRoundStartWithServerDeadline() {
        synchronizationService.initialize("room-a", 1, List.of("player-a"));

        Instant deadline = timerService.start("room-a", 1, "player-a");

        assertThat(deadline).isEqualTo(NOW.plusSeconds(25));
        assertThat(scheduler.deadline).isEqualTo(deadline);
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
    void timeoutAdvancesToTheNextPlayersTurn() {
        synchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        timerService.start("room-a", 1, "player-a");
        reset(broadcaster);

        scheduler.fire();

        WsEnvelope<?> message = capturedBroadcast();
        assertThat(message.type()).isEqualTo("round.start");
        assertThat(message.payload()).isEqualTo(
                new RoundStartPayload(1, NOW.plusSeconds(25).toEpochMilli(), "player-b")
        );
        assertThat(stateStore.findByRoomId("room-a")).hasValueSatisfying(state -> {
            assertThat(state.roundNumber()).isEqualTo(1);
            assertThat(state.activePlayerId()).isEqualTo("player-b");
        });
    }

    @Test
    void staleTimeoutDoesNotCompleteAlreadyAdvancedRound() {
        synchronizationService.initialize("room-a", 1, List.of("player-a"));
        timerService.start("room-a", 1, "player-a");
        synchronizationService.submit("room-a", "player-a", payload(1));
        reset(broadcaster);

        scheduler.fire();

        verify(broadcaster, never()).broadcast(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any()
        );
        assertThat(stateStore.findByRoomId("room-a").orElseThrow().roundNumber()).isEqualTo(2);
    }

    private WsEnvelope<?> capturedBroadcast() {
        ArgumentCaptor<WsEnvelope<?>> captor = ArgumentCaptor.forClass(WsEnvelope.class);
        verify(broadcaster).broadcast(org.mockito.ArgumentMatchers.eq("room-a"), captor.capture());
        return captor.getValue();
    }

    private static RoundSubmitPayload payload(int roundNumber) {
        return new RoundSubmitPayload(roundNumber, List.of(1, 2, 3, 4, 5), "smallStraight");
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
