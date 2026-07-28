package com.ssafy.yorr.room.controller;

import com.ssafy.yorr.handler.GameWebSocketHandler;
import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomPlayerSnapshot;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomValidationService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RoomValidationControllerTest {

    private static final String ROOM = "ROOM01";
    private static final String HOST_ID = "host-1";
    private static final String AUTH = "Bearer token";

    private RoomValidationService roomService;
    private UserService userService;
    private RoomSessionRegistry registry;
    private GameWebSocketHandler handler;
    private RoomValidationController controller;

    @BeforeEach
    void setUp() {
        roomService = mock(RoomValidationService.class);
        userService = mock(UserService.class);
        registry = mock(RoomSessionRegistry.class);
        handler = mock(GameWebSocketHandler.class);
        controller = new RoomValidationController(roomService, userService, registry, handler);

        when(userService.authenticate(HOST_ID, AUTH))
                .thenReturn(new UserIdentity(HOST_ID, "호스트", UserType.GUEST));
        when(roomService.getSnapshot(ROOM)).thenReturn(lobbyWithHost());
    }

    private RoomSnapshot lobbyWithHost() {
        return new RoomSnapshot(ROOM, null, HOST_ID, RoomPhase.LOBBY, 6,
                List.of(new RoomPlayerSnapshot(HOST_ID, "호스트", 0),
                        new RoomPlayerSnapshot("guest-1", "참가자", 0)));
    }

    /**
     * 시작을 누른 호스트는 HTTP 응답으로 이동하지만, 나머지 참가자는 소켓 알림으로만 알 수 있다.
     * 이 브로드캐스트가 빠지면 2인 방에서 방장만 게임에 들어가고 참가자는 대기실에 남는다.
     */
    @Test
    void broadcastsToTheRoomSoNonHostPlayersLeaveTheLobby() {
        when(roomService.startGame(ROOM))
                .thenReturn(new GameStartResponse("game-1", lobbyWithHost()));

        ResponseEntity<?> response = controller.startGame(ROOM, HOST_ID, AUTH);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        verify(registry).markPhase(ROOM, com.ssafy.yorr.ws.dto.RoomPhase.PLAYING);
        verify(handler).broadcastStateSync(ROOM);
    }

    @Test
    void doesNotBroadcastWhenTheStartIsRejected() {
        when(roomService.startGame(ROOM)).thenThrow(new IllegalStateException("game_not_ready"));

        ResponseEntity<?> response = controller.startGame(ROOM, HOST_ID, AUTH);

        assertThat(response.getStatusCode().value()).isEqualTo(409);
        verify(handler, never()).broadcastStateSync(anyString());
        verify(registry, never()).markPhase(anyString(), any());
    }

    @Test
    void doesNotBroadcastWhenANonHostTriesToStart() {
        when(userService.authenticate("guest-1", AUTH))
                .thenReturn(new UserIdentity("guest-1", "참가자", UserType.GUEST));

        ResponseEntity<?> response = controller.startGame(ROOM, "guest-1", AUTH);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        verify(handler, never()).broadcastStateSync(anyString());
    }
}
