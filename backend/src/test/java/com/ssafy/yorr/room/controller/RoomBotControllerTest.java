package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.BotParticipantService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.ws.RealtimeRoomSnapshotService;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RoomBotControllerTest {

    private static final String ROOM = "ROOM1";
    private static final String HOST = "host-1";

    private BotParticipantService bots;
    private UserService users;
    private RealtimeRoomSnapshotService realtimeSnapshots;
    private RoomBroadcaster broadcaster;
    private RoomBotController controller;

    @BeforeEach
    void setUp() {
        bots = mock(BotParticipantService.class);
        users = mock(UserService.class);
        realtimeSnapshots = mock(RealtimeRoomSnapshotService.class);
        broadcaster = mock(RoomBroadcaster.class);
        controller = new RoomBotController(bots, users, realtimeSnapshots, broadcaster);
        when(users.authenticate(HOST, "Bearer token"))
                .thenReturn(new UserIdentity(HOST, "호스트", UserType.GUEST));
    }

    @Test
    void addsBotAndBroadcastsTheMergedSnapshot() {
        RoomSnapshot persistent = new RoomSnapshot(
                ROOM, "YACHT_DICE", null, HOST, RoomPhase.LOBBY, 6, List.of()
        );
        com.ssafy.yorr.ws.dto.RoomSnapshot realtime = new com.ssafy.yorr.ws.dto.RoomSnapshot(
                ROOM,
                "YACHT_DICE",
                com.ssafy.yorr.ws.dto.RoomPhase.WAITING,
                HOST,
                List.of(),
                null
        );
        when(bots.add(ROOM, HOST)).thenReturn(persistent);
        when(realtimeSnapshots.snapshot(ROOM)).thenReturn(realtime);

        var response = controller.add(
                ROOM,
                HOST,
                "Bearer token"
        );

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).isEqualTo(persistent);
        ArgumentCaptor<WsEnvelope<?>> message = ArgumentCaptor.forClass(WsEnvelope.class);
        verify(broadcaster).broadcast(eq(ROOM), message.capture());
        assertThat(message.getValue().type()).isEqualTo("state.sync");
    }

    @Test
    void rejectsNonHostMutation() {
        when(bots.remove(ROOM, HOST, "bot-1")).thenThrow(new SecurityException("host_only"));

        var response = controller.remove(ROOM, "bot-1", HOST, "Bearer token");

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).isEqualTo("host_only");
    }
}
