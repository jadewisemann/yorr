package com.ssafy.yorr.game.pingpong;

import com.ssafy.yorr.game.round.application.GameCompletionService;
import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import com.ssafy.yorr.room.service.RoomValidationService;
import com.ssafy.yorr.ws.RealtimeRoomSnapshotService;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.RoomPhase;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PingPongGameServiceTest {

    private RedisPingPongStateStore states;
    private RoundDeadlineScheduler scheduler;
    private RoomBroadcaster broadcaster;
    private RealtimeRoomSnapshotService snapshots;
    private RoomSessionRegistry sessions;
    private RoomValidationService rooms;
    private PingPongGameService service;

    @BeforeEach
    void setUp() {
        states = mock(RedisPingPongStateStore.class);
        scheduler = mock(RoundDeadlineScheduler.class);
        broadcaster = mock(RoomBroadcaster.class);
        snapshots = mock(RealtimeRoomSnapshotService.class);
        sessions = mock(RoomSessionRegistry.class);
        rooms = mock(RoomValidationService.class);
        service = new PingPongGameService(
                states,
                scheduler,
                broadcaster,
                snapshots,
                sessions,
                mock(GameCompletionService.class),
                mock(StringRedisTemplate.class),
                rooms
        );
    }

    @Test
    void leavingDuringPreparationRemovesThePlayerAndReopensTheRoom() {
        String roomId = "room-a";
        String playerId = "player-1";
        PingPongState preparing = PingPongRules.initial(List.of(playerId, "player-2"), 1_000);
        RoomSnapshot lobby = new RoomSnapshot(roomId, "PING_PONG", RoomPhase.WAITING,
                "player-2", List.of(), null, 2);
        when(states.find(roomId)).thenReturn(Optional.of(preparing));
        when(rooms.leave(roomId, playerId)).thenReturn(true);
        when(snapshots.snapshot(roomId)).thenReturn(lobby);

        service.removePlayer(roomId, playerId);

        verify(sessions).removePlayer(roomId, playerId);
        verify(rooms).leave(roomId, playerId);
        verify(scheduler).cancelRoom(roomId);
        verify(states).remove(roomId);
        verify(rooms).cancelActiveGame(roomId);
        verify(sessions).markPhase(roomId, RoomPhase.WAITING);

        ArgumentCaptor<WsEnvelope<?>> messages = ArgumentCaptor.forClass(WsEnvelope.class);
        verify(broadcaster, org.mockito.Mockito.times(2)).broadcast(eq(roomId), messages.capture());
        assertThat(messages.getAllValues()).extracting(WsEnvelope::type)
                .containsExactly("room.player_left", "game.ping_pong.state.sync");
    }
}
