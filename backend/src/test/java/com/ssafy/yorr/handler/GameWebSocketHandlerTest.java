package com.ssafy.yorr.handler;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.dto.ScoreConfirmationCommand;
import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionService;
import com.ssafy.yorr.game.round.application.RoundTimerService;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.ws.InMemoryRoomBroadcaster;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.RoomJoinPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
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
import java.util.Map;

import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.STORE_FAILURE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verifyNoMoreInteractions;

class GameWebSocketHandlerTest {

    private ObjectMapper objectMapper;
    private InMemoryRoomBroadcaster broadcaster;
    private RoomSessionRegistry registry;
    private InMemoryRoundStateStore roundStateStore;
    private RoundSynchronizationService roundSynchronizationService;
    private ScoreConfirmationService scoreConfirmationService;
    private RoomService roomService;
    private ScoreRoundSubmissionService scoreRoundSubmissionService;
    private RoundTimerService roundTimerService;
    private TestGameWebSocketHandler handler;

    @BeforeEach
    void setUp() {
        objectMapper = new JsonMapper();
        broadcaster = new InMemoryRoomBroadcaster(objectMapper);
        registry = new RoomSessionRegistry();
        roundStateStore = new InMemoryRoundStateStore();
        roundSynchronizationService = new RoundSynchronizationService(roundStateStore);
        scoreConfirmationService = mock(ScoreConfirmationService.class);
        roomService = mock(RoomService.class);
        scoreRoundSubmissionService = new ScoreRoundSubmissionService(
                roundSynchronizationService,
                scoreConfirmationService,
                roomService
        );
        roundTimerService = mock(RoundTimerService.class);
        when(roomService.getSnapshot(any())).thenAnswer(invocation -> {
            String roomId = invocation.getArgument(0);
            return new RoomSnapshot(
                    roomId,
                    "game-a",
                    "player-a",
                    RoomPhase.PLAYING,
                    2,
                    List.of()
            );
        });
        when(scoreConfirmationService.confirm(any())).thenAnswer(invocation ->
                confirmedScore(invocation.getArgument(0))
        );
        handler = new TestGameWebSocketHandler(
                objectMapper,
                broadcaster,
                registry,
                mock(UserService.class),
                scoreRoundSubmissionService,
                roundSynchronizationService,
                roundTimerService
        );
    }

    @Test
    void broadcastsScoreUpdateBeforeRoundEndWhenLastSubmissionCompletes() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerA, "player-a", "Player A");
        registry.join("room-a", playerB, "player-b", "Player B");
        broadcaster.register("room-a", playerA);
        broadcaster.register("room-a", playerB);

        handler.handle(playerA, submitMessage("room-a", "player-a-message"));

        verify(roundTimerService).cancel("room-a", 1);
        verify(roundTimerService).start("room-a", 1, "player-b");
        assertSingleScoreUpdate(playerA, "player-a", "player-a-message");
        assertSingleScoreUpdate(playerB, "player-a", "player-a-message");
        clearInvocations(playerA, playerB);

        handler.handle(playerB, submitMessage("room-a", "player-b-message"));

        verify(roundTimerService, times(2)).cancel("room-a", 1);
        verify(roundTimerService).start("room-a", 2, "player-a");
        assertScoreUpdateThenRoundEnd(playerA, "player-b", "player-b-message");
        assertScoreUpdateThenRoundEnd(playerB, "player-b", "player-b-message");
    }

    @Test
    void scoreStoreFailureDoesNotMarkPlayerSubmitted() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        registry.join("room-a", playerA, "player-a", "Player A");
        broadcaster.register("room-a", playerA);
        doThrow(new ScoreConfirmationException(STORE_FAILURE, "redis unavailable"))
                .when(scoreConfirmationService)
                .confirm(any());

        handler.handle(playerA, submitMessage("room-a", "failed-score-message"));

        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(playerA).sendMessage(captor.capture());
        String response = ((TextMessage) captor.getValue()).getPayload();
        assertThat(response).contains("\"type\":\"error\"");
        assertThat(response).contains("\"code\":\"INTERNAL\"");
        assertThat(response).contains("\"refMsgId\":\"failed-score-message\"");
        assertThat(roundStateStore.findByRoomId("room-a")).hasValueSatisfying(state -> {
            assertThat(state.roundNumber()).isEqualTo(1);
            assertThat(state.submittedPlayerIds()).isEmpty();
        });
        verify(roundTimerService, never()).cancel(any(), anyInt());
    }

    @Test
    void rejectsScoreSubmissionFromPlayerWhoDoesNotOwnTheTurn() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerB, "player-b", "Player B");
        broadcaster.register("room-a", playerB);

        handler.handle(playerB, submitMessage("room-a", "out-of-turn-message"));

        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(playerB).sendMessage(captor.capture());
        String response = ((TextMessage) captor.getValue()).getPayload();
        assertThat(response).contains("\"type\":\"error\"");
        assertThat(response).contains("\"code\":\"INVALID_MESSAGE\"");
        assertThat(response).contains("\"refMsgId\":\"out-of-turn-message\"");
        verify(scoreConfirmationService, never()).confirm(any());
        assertThat(roundStateStore.findByRoomId("room-a")).hasValueSatisfying(state ->
                assertThat(state.activePlayerId()).isEqualTo("player-a")
        );
    }

    @Test
    void restartsTheCurrentPlayersTimerAfterEachAcceptedRoll() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        registry.join("room-a", playerA, "player-a", "Player A");
        broadcaster.register("room-a", playerA);

        handler.handle(playerA, rollMessage("room-a", 1, "roll-one"));
        handler.handle(playerA, rollMessage("room-a", 2, "roll-two"));

        verify(roundTimerService, times(2)).start("room-a", 1, "player-a");
        assertThat(roundStateStore.findByRoomId("room-a")).hasValueSatisfying(state ->
                assertThat(state.activeRollCount()).isEqualTo(2)
        );
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

    @Test
    void reusesExistingGuestForWebSocketReconnect() throws Exception {
        UserService userService = mock(UserService.class);
        handler = new TestGameWebSocketHandler(
                objectMapper,
                broadcaster,
                registry,
                userService,
                scoreRoundSubmissionService,
                roundSynchronizationService,
                roundTimerService
        );
        when(userService.authenticateSession("token-a"))
                .thenReturn(new UserIdentity("player-a", "Player A", UserType.GUEST));
        WebSocketSession session = sessionWithPlayer("player-a");
        TextMessage message = new TextMessage(objectMapper.writeValueAsString(new WsEnvelope<>(
                "room.join", System.currentTimeMillis(), new RoomJoinPayload("room-a", "ignored", "token-a"), null, "join-a")));

        handler.handle(session, message);

        verify(userService).authenticateSession("token-a");
        verifyNoMoreInteractions(userService);
        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(session).sendMessage(captor.capture());
        assertThat(((TextMessage) captor.getValue()).getPayload()).contains("\"you\":\"player-a\"");
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

    private TextMessage rollMessage(String roomId, int rollCount, String msgId) throws Exception {
        String message = objectMapper.writeValueAsString(new WsEnvelope<>(
                "dice.roll",
                System.currentTimeMillis(),
                new DiceRollPayload(1, rollCount, List.of(1, 2, 3, 4, 5)),
                roomId,
                msgId
        ));
        return new TextMessage(message);
    }

    private static void assertSingleScoreUpdate(
            WebSocketSession session,
            String playerId,
            String msgId
    ) throws Exception {
        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(session).sendMessage(captor.capture());
        String response = ((TextMessage) captor.getValue()).getPayload();

        assertThat(response).contains("\"type\":\"score.update\"");
        assertThat(response).contains("\"roomId\":\"room-a\"");
        assertThat(response).contains("\"msgId\":\"" + msgId + "\"");
        assertThat(response).contains("\"playerId\":\"" + playerId + "\"");
        assertThat(response).contains("\"smallStraight\":15");
        assertThat(response).contains("\"total\":15");
    }

    private static void assertScoreUpdateThenRoundEnd(
            WebSocketSession session,
            String playerId,
            String msgId
    ) throws Exception {
        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(session, times(2)).sendMessage(captor.capture());
        List<WebSocketMessage<?>> messages = captor.getAllValues();
        String scoreUpdate = ((TextMessage) messages.get(0)).getPayload();
        String roundEnd = ((TextMessage) messages.get(1)).getPayload();

        assertThat(scoreUpdate).contains("\"type\":\"score.update\"");
        assertThat(scoreUpdate).contains("\"msgId\":\"" + msgId + "\"");
        assertThat(scoreUpdate).contains("\"playerId\":\"" + playerId + "\"");
        assertThat(scoreUpdate).contains("\"total\":15");

        assertThat(roundEnd).contains("\"type\":\"round.end\"");
        assertThat(roundEnd).contains("\"roomId\":\"room-a\"");
        assertThat(roundEnd).doesNotContain("\"msgId\"");
        assertThat(roundEnd).contains("\"roundNumber\":1");
        assertThat(roundEnd).contains("\"submitted\":[\"player-a\",\"player-b\"]");
    }

    private static ScoreConfirmationResult confirmedScore(ScoreConfirmationCommand command) {
        return new ScoreConfirmationResult(
                command.gameId(),
                command.playerId(),
                command.roundNumber(),
                command.category(),
                15,
                new ScoreBoard(Map.of("smallStraight", 15), 0, 0, 15)
        );
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
                ScoreRoundSubmissionService scoreRoundSubmissionService,
                RoundSynchronizationService roundSynchronizationService,
                RoundTimerService roundTimerService
        ) {
            super(
                    objectMapper,
                    broadcaster,
                    registry,
                    userService,
                    scoreRoundSubmissionService,
                    roundSynchronizationService,
                    roundTimerService
            );
        }

        void handle(WebSocketSession session, TextMessage message) throws Exception {
            handleTextMessage(session, message);
        }
    }
}
