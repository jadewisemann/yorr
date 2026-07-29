package com.ssafy.yorr.handler;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.dto.ScoreConfirmationCommand;
import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionResult;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionService;
import com.ssafy.yorr.game.round.application.RoundTimerService;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.ws.InMemoryRoomBroadcaster;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.RoomJoinPayload;
import com.ssafy.yorr.ws.dto.DiceHoldPayload;
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
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
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

    /**
     * 점수 방송·라운드 종료·다음 턴·게임 종료 판단은 전부 advanceTurn 한 곳에 있다(마감 만료 경로와 공유).
     * 핸들러의 책임은 "확정된 제출 결과와 요청 msgId를 그대로 넘기는 것"까지다.
     * 방송 내용·순서는 {@code RoundTimerServiceTest}가 검증한다.
     */
    @Test
    void delegatesTurnAdvanceToTheSharedPathWithTheRequestMsgId() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerA, "player-a", "Player A");
        registry.join("room-a", playerB, "player-b", "Player B");
        broadcaster.register("room-a", playerA);
        broadcaster.register("room-a", playerB);

        handler.handle(playerA, submitMessage("room-a", "player-a-message"));

        ScoreRoundSubmissionResult firstTurn = capturedAdvance("player-a-message");
        assertThat(firstTurn.score().playerId()).isEqualTo("player-a");
        assertThat(firstTurn.round().roundCompleted()).isFalse();
        assertThat(firstTurn.round().state().activePlayerId()).isEqualTo("player-b");

        handler.handle(playerB, submitMessage("room-a", "player-b-message"));

        ScoreRoundSubmissionResult lastTurn = capturedAdvance("player-b-message");
        assertThat(lastTurn.round().roundCompleted()).isTrue();
        assertThat(lastTurn.round().state().roundNumber()).isEqualTo(2);
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
        verify(roundTimerService, never()).advanceTurn(any(), any(), any());
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
        assertThat(response).contains("\"code\":\"NOT_YOUR_TURN\"");
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

        verify(roundTimerService, times(2)).start(
                eq("room-a"),
                argThat(state -> state.roundNumber() == 1 && state.activePlayerId().equals("player-a"))
        );
        assertThat(roundStateStore.findByRoomId("room-a")).hasValueSatisfying(state ->
                assertThat(state.activeRollCount()).isEqualTo(2)
        );
    }

    @Test
    void broadcastsTheServerGeneratedDiceToEveryPlayerInTheRoom() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerA, "player-a", "Player A");
        broadcaster.register("room-a", playerA);
        broadcaster.register("room-a", playerB);

        handler.handle(playerA, rollMessage("room-a", 1, "roll-one"));

        ArgumentCaptor<WebSocketMessage<?>> playerACaptor =
                ArgumentCaptor.forClass(WebSocketMessage.class);
        ArgumentCaptor<WebSocketMessage<?>> playerBCaptor =
                ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(playerA).sendMessage(playerACaptor.capture());
        verify(playerB).sendMessage(playerBCaptor.capture());
        String playerAMessage = ((TextMessage) playerACaptor.getValue()).getPayload();
        String playerBMessage = ((TextMessage) playerBCaptor.getValue()).getPayload();

        assertThat(playerAMessage).isEqualTo(playerBMessage);
        assertThat(playerAMessage).contains("\"type\":\"dice.broadcast\"");
        assertThat(playerAMessage).contains("\"playerId\":\"player-a\"");
        assertThat(playerAMessage).contains("\"roundNumber\":1");
        assertThat(playerAMessage).contains("\"rollCount\":1");
        assertThat(playerAMessage).contains("\"dice\":[");
        assertThat(playerAMessage).contains("\"held\":[false,false,false,false,false]");
        // 플레이어가 직접 굴린 결과다 — 마감 자동 굴림과 구분된다.
        assertThat(playerAMessage).contains("\"auto\":false");
    }

    @Test
    void rejectsDiceRollFromPlayerWhoDoesNotOwnTheTurn() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerB, "player-b", "Player B");
        broadcaster.register("room-a", playerB);

        handler.handle(playerB, rollMessage("room-a", 1, "out-of-turn-roll"));

        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(playerB).sendMessage(captor.capture());
        String response = ((TextMessage) captor.getValue()).getPayload();
        assertThat(response).contains("\"type\":\"error\"");
        assertThat(response).contains("\"code\":\"NOT_YOUR_TURN\"");
        assertThat(response).contains("\"refMsgId\":\"out-of-turn-roll\"");
        // 남의 턴에 보낸 굴림은 상태를 전혀 건드리지 못한다.
        assertThat(roundStateStore.findByRoomId("room-a")).hasValueSatisfying(state -> {
            assertThat(state.activeRollCount()).isZero();
            assertThat(state.activeDice()).isNull();
        });
        verify(roundTimerService, never()).start(any(), any());
    }

    @Test
    void broadcastsKeepChangesBetweenRollsToEveryPlayerInTheRoom() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerA, "player-a", "Player A");
        broadcaster.register("room-a", playerA);
        broadcaster.register("room-a", playerB);
        handler.handle(playerA, rollMessage("room-a", 1, "roll-one"));
        clearInvocations(playerA, playerB);

        handler.handle(playerA, holdMessage("room-a", List.of(true, true, false, false, false), "hold-one"));

        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(playerB).sendMessage(captor.capture());
        String response = ((TextMessage) captor.getValue()).getPayload();
        assertThat(response).contains("\"type\":\"dice.hold_changed\"");
        assertThat(response).contains("\"playerId\":\"player-a\"");
        assertThat(response).contains("\"held\":[true,true,false,false,false]");
        // KEEP 변경은 마감 타이머를 다시 걸지 않는다 — 토글로 턴을 무한히 늘릴 수 없어야 한다.
        verify(roundTimerService, times(1)).start(any(), any());
        assertThat(roundStateStore.findByRoomId("room-a")).hasValueSatisfying(state ->
                assertThat(state.activeHeld()).containsExactly(true, true, false, false, false)
        );
    }

    @Test
    void rejectsKeepChangeFromPlayerWhoDoesNotOwnTheTurn() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerA, "player-a", "Player A");
        registry.join("room-a", playerB, "player-b", "Player B");
        broadcaster.register("room-a", playerA);
        broadcaster.register("room-a", playerB);
        handler.handle(playerA, rollMessage("room-a", 1, "roll-one"));
        clearInvocations(playerA, playerB);

        handler.handle(playerB, holdMessage("room-a", List.of(true, false, false, false, false), "steal-hold"));

        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(playerB).sendMessage(captor.capture());
        String response = ((TextMessage) captor.getValue()).getPayload();
        assertThat(response).contains("\"code\":\"NOT_YOUR_TURN\"");
        assertThat(response).contains("\"refMsgId\":\"steal-hold\"");
        assertThat(roundStateStore.findByRoomId("room-a")).hasValueSatisfying(state ->
                assertThat(state.activeHeld()).containsExactly(false, false, false, false, false)
        );
    }

    @Test
    void rejectsKeepChangeBeforeTheFirstRoll() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        registry.join("room-a", playerA, "player-a", "Player A");
        broadcaster.register("room-a", playerA);

        handler.handle(playerA, holdMessage("room-a", List.of(true, false, false, false, false), "early-hold"));

        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(playerA).sendMessage(captor.capture());
        assertThat(((TextMessage) captor.getValue()).getPayload())
                .contains("\"code\":\"INVALID_MESSAGE\"")
                .contains("\"refMsgId\":\"early-hold\"");
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

    /**
     * 만료된 토큰은 SESSION_EXPIRED로 알려야 한다. INVALID_MESSAGE로 뭉개면 클라이언트가
     * 세션 종료로 다루지 않아 대기실에서 안내 없이 멈춘다(S15P11A406-110).
     */
    @Test
    void reportsExpiredSessionTokenAsSessionExpired() throws Exception {
        UserService userService = mock(UserService.class);
        handler = handlerWith(userService);
        when(userService.authenticateSession("stale-token")).thenThrow(new SessionAuthenticationException());

        WebSocketSession session = sessionWithPlayer("player-a");
        handler.handle(session, joinMessage("stale-token", "join-stale"));

        String response = singleResponse(session);
        assertThat(response).contains("\"type\":\"error\"");
        assertThat(response).contains("\"code\":\"SESSION_EXPIRED\"");
        assertThat(response).contains("\"refMsgId\":\"join-stale\"");
        // 인증이 실패했으므로 명단에도 올라가지 않는다.
        assertThat(registry.of(session)).isNull();
    }

    /** 닉네임 규칙 위반은 그대로 INVALID_MESSAGE다 — 두 실패가 다시 뭉치지 않게 함께 고정한다. */
    @Test
    void stillReportsInvalidNicknameAsInvalidMessage() throws Exception {
        UserService userService = mock(UserService.class);
        handler = handlerWith(userService);
        when(userService.createGuest(any())).thenThrow(new IllegalArgumentException("invalid_nickname"));

        WebSocketSession session = sessionWithPlayer("player-a");
        handler.handle(session, joinMessage(null, "join-bad-nickname"));

        String response = singleResponse(session);
        assertThat(response).contains("\"code\":\"INVALID_MESSAGE\"");
        assertThat(response).contains("닉네임");
    }

    private TestGameWebSocketHandler handlerWith(UserService userService) {
        return new TestGameWebSocketHandler(
                objectMapper,
                broadcaster,
                registry,
                userService,
                scoreRoundSubmissionService,
                roundSynchronizationService,
                roundTimerService
        );
    }

    private TextMessage joinMessage(String sessionToken, String msgId) {
        return new TextMessage(objectMapper.writeValueAsString(new WsEnvelope<>(
                "room.join",
                System.currentTimeMillis(),
                new RoomJoinPayload("room-a", "닉네임", sessionToken),
                null,
                msgId
        )));
    }

    private static String singleResponse(WebSocketSession session) throws Exception {
        ArgumentCaptor<WebSocketMessage<?>> captor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(session).sendMessage(captor.capture());
        return ((TextMessage) captor.getValue()).getPayload();
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
                new DiceRollPayload(1, rollCount, List.of(false, false, false, false, false)),
                roomId,
                msgId
        ));
        return new TextMessage(message);
    }

    private TextMessage holdMessage(String roomId, List<Boolean> held, String msgId) throws Exception {
        String message = objectMapper.writeValueAsString(new WsEnvelope<>(
                "dice.hold",
                System.currentTimeMillis(),
                new DiceHoldPayload(1, held),
                roomId,
                msgId
        ));
        return new TextMessage(message);
    }

    /** advanceTurn에 넘어간 제출 결과. 마지막 호출 하나만 본다(테스트마다 제출 1건). */
    private ScoreRoundSubmissionResult capturedAdvance(String msgId) {
        ArgumentCaptor<ScoreRoundSubmissionResult> captor =
                ArgumentCaptor.forClass(ScoreRoundSubmissionResult.class);
        verify(roundTimerService).advanceTurn(eq("room-a"), captor.capture(), eq(msgId));
        return captor.getValue();
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
