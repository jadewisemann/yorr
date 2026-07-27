package com.ssafy.yorr.handler;

import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.ws.InMemoryRoomBroadcaster;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.HashMap;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GameWebSocketHandlerTest {

    private ObjectMapper objectMapper;
    private InMemoryRoomBroadcaster broadcaster;
    private RoomSessionRegistry registry;
    private RoundSynchronizationService roundSynchronizationService;
    private TestGameWebSocketHandler handler;

    @BeforeEach
    void setUp() {
        objectMapper = new JsonMapper();
        broadcaster = new InMemoryRoomBroadcaster(objectMapper);
        registry = new RoomSessionRegistry();
        roundSynchronizationService = new RoundSynchronizationService(new InMemoryRoundStateStore());
        handler = new TestGameWebSocketHandler(
                objectMapper,
                broadcaster,
                registry,
                mock(UserService.class),
                roundSynchronizationService
        );
    }

    @Test
    void broadcastsRoundEndToEveryRoomSessionWhenLastSubmissionCompletes() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerA, "player-a", "Player A");
        registry.join("room-a", playerB, "player-b", "Player B");
        broadcaster.register("room-a", playerA);
        broadcaster.register("room-a", playerB);

        handler.handle(playerA, submitMessage("room-a", "player-a-message"));

        verify(playerA, never()).sendMessage(org.mockito.ArgumentMatchers.any());
        verify(playerB, never()).sendMessage(org.mockito.ArgumentMatchers.any());

        handler.handle(playerB, submitMessage("room-a", "player-b-message"));

        assertRoundEndWasSent(playerA);
        assertRoundEndWasSent(playerB);
    }

    @Test
    void rejectsSubmissionForRoomOtherThanSessionRoom() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a"));
        WebSocketSession session = sessionWithPlayer("player-a");
        registry.join("room-b", session, "player-a", "Player A");
        broadcaster.register("room-b", session);

        handler.handle(session, submitMessage("room-a", "wrong-room-message"));

        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(session).sendMessage(captor.capture());
        String response = ((TextMessage) captor.getValue()).getPayload();

        assertThat(response).contains("\"type\":\"error\"");
        assertThat(response).contains("\"code\":\"NOT_IN_ROOM\"");
        assertThat(response).contains("\"refMsgId\":\"wrong-room-message\"");
    }

    private TextMessage submitMessage(String roomId, String msgId) throws Exception {
        String message = objectMapper.writeValueAsString(new WsEnvelope<>(
                "round.submit",
                System.currentTimeMillis(),
                new RoundSubmitPayload(1, List.of(1, 2, 3, 4, 5), "smallStraight"),
                roomId,
                msgId
        ));
        return new TextMessage(message);
    }

    private static void assertRoundEndWasSent(WebSocketSession session) throws Exception {
        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(session).sendMessage(captor.capture());
        String response = ((TextMessage) captor.getValue()).getPayload();

        assertThat(response).contains("\"type\":\"round.end\"");
        assertThat(response).contains("\"roomId\":\"room-a\"");
        assertThat(response).doesNotContain("\"msgId\"");
        assertThat(response).contains("\"roundNumber\":1");
        assertThat(response).contains("\"submitted\":[\"player-a\",\"player-b\"]");
    }

    private static WebSocketSession sessionWithPlayer(String playerId) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(playerId + "-session");
        when(session.getAttributes()).thenReturn(new HashMap<>());
        when(session.isOpen()).thenReturn(true);
        return session;
    }

    private static class TestGameWebSocketHandler extends GameWebSocketHandler {

        TestGameWebSocketHandler(
                ObjectMapper objectMapper,
                InMemoryRoomBroadcaster broadcaster,
                RoomSessionRegistry registry,
                UserService userService,
                RoundSynchronizationService roundSynchronizationService
        ) {
            super(objectMapper, broadcaster, registry, userService, roundSynchronizationService);
        }

        void handle(WebSocketSession session, TextMessage message) throws Exception {
            handleTextMessage(session, message);
        }
    }
}
