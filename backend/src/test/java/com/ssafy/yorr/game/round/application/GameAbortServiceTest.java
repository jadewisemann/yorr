package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.RoomCloseReason;
import com.ssafy.yorr.ws.dto.RoomClosedPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

class GameAbortServiceTest {

    private RoundSynchronizationService synchronizationService;
    private RoundTimerService timerService;
    private RoomBroadcaster broadcaster;
    private GameAbortService abortService;

    @BeforeEach
    void setUp() {
        synchronizationService = new RoundSynchronizationService(new InMemoryRoundStateStore());
        timerService = mock(RoundTimerService.class);
        broadcaster = mock(RoomBroadcaster.class);
        abortService = new GameAbortService(synchronizationService, timerService, broadcaster);
    }

    @Test
    void cancelsRoundAndBroadcastsRoomClosed() {
        synchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));

        boolean aborted = abortService.abortForNotEnoughPlayers("room-a");

        assertThat(aborted).isTrue();
        verify(timerService).cancelRoom("room-a");
        WsEnvelope<?> message = capturedBroadcast();
        assertThat(message.type()).isEqualTo("room.closed");
        assertThat(message.roomId()).isEqualTo("room-a");
        assertThat(message.msgId()).isNull();
        assertThat(message.payload()).isEqualTo(
                new RoomClosedPayload(RoomCloseReason.NOT_ENOUGH_PLAYERS)
        );
    }

    @Test
    void duplicateAbortDoesNotCancelOrBroadcastAgain() {
        synchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));

        assertThat(abortService.abortForNotEnoughPlayers("room-a")).isTrue();
        assertThat(abortService.abortForNotEnoughPlayers("room-a")).isFalse();

        verify(timerService, times(1)).cancelRoom("room-a");
        capturedBroadcast();
        verifyNoMoreInteractions(timerService, broadcaster);
    }

    private WsEnvelope<?> capturedBroadcast() {
        ArgumentCaptor<WsEnvelope<?>> captor = ArgumentCaptor.forClass(WsEnvelope.class);
        verify(broadcaster).broadcast(org.mockito.ArgumentMatchers.eq("room-a"), captor.capture());
        return captor.getValue();
    }
}
