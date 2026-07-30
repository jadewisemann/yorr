package com.ssafy.yorr.handler;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.dto.ScoreConfirmationCommand;
import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.application.GameReconnectSnapshotService;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionResult;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionService;
import com.ssafy.yorr.game.round.application.RoundTimerService;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import com.ssafy.yorr.room.port.RoomCloseScheduler;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.ws.InMemoryRoomBroadcaster;
import com.ssafy.yorr.ws.HeartbeatMonitor;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.RoomJoinPayload;
import com.ssafy.yorr.ws.dto.DiceHoldPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import com.ssafy.yorr.ws.dto.GameState;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.time.Duration;
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
    private HeartbeatMonitor heartbeatMonitor;
    private InMemoryRoundStateStore roundStateStore;
    private RoundSynchronizationService roundSynchronizationService;
    private ScoreConfirmationService scoreConfirmationService;
    private RoomService roomService;
    private ScoreRoundSubmissionService scoreRoundSubmissionService;
    private RoundTimerService roundTimerService;
    private FakeRoomCloseScheduler roomCloseScheduler;
    private GameReconnectSnapshotService reconnectSnapshotService;
    private TestGameWebSocketHandler handler;

    @BeforeEach
    void setUp() {
        objectMapper = new JsonMapper();
        broadcaster = new InMemoryRoomBroadcaster(objectMapper);
        registry = new RoomSessionRegistry();
        heartbeatMonitor = mock(HeartbeatMonitor.class);
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
        roomCloseScheduler = new FakeRoomCloseScheduler();
        reconnectSnapshotService = mock(GameReconnectSnapshotService.class);
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
                heartbeatMonitor,
                mock(UserService.class),
                scoreRoundSubmissionService,
                roundSynchronizationService,
                roundTimerService,
                roomService,
                roomCloseScheduler,
                reconnectSnapshotService
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
    void stopsTheTimerAndSchedulesCloseWhenTheLastSocketLeaves() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        registry.join("room-a", playerA, "player-a", "Player A");
        broadcaster.register("room-a", playerA);

        handler.afterConnectionClosed(playerA, CloseStatus.NORMAL);

        // 타이머는 즉시 끊는다 — 빈 방에서 자동 굴림·자동 기록이 계속 돌면 안 된다.
        verify(roundTimerService).cancelRoom("room-a");
        assertThat(roomCloseScheduler.isPending("room-a")).isTrue();
        assertThat(roomCloseScheduler.lastDelay).isEqualTo(GameWebSocketHandler.EMPTY_ROOM_GRACE);
        // 진행 상태는 아직 살려둔다 — 새로고침으로 돌아올 수 있다.
        assertThat(roundStateStore.findByRoomId("room-a")).isPresent();
        verify(roomService, never()).close(any());
    }

    @Test
    void closesTheRoomWhenNobodyReturnsBeforeTheGraceEnds() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        registry.join("room-a", playerA, "player-a", "Player A");
        broadcaster.register("room-a", playerA);
        handler.afterConnectionClosed(playerA, CloseStatus.NORMAL);

        roomCloseScheduler.fire("room-a");

        verify(roomService).close("room-a");
        assertThat(roundStateStore.findByRoomId("room-a")).isEmpty();
    }

    @Test
    void keepsTheRoomWhenSomeoneReturnsDuringTheGrace() throws Exception {
        UserService userService = mock(UserService.class);
        when(userService.authenticateSession("token-a"))
                .thenReturn(new UserIdentity("player-a", "Player A", UserType.GUEST));
        handler = handlerWith(userService);
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a"));
        WebSocketSession first = sessionWithPlayer("player-a");
        registry.join("room-a", first, "player-a", "Player A");
        broadcaster.register("room-a", first);
        handler.afterConnectionClosed(first, CloseStatus.NORMAL);
        assertThat(roomCloseScheduler.isPending("room-a")).isTrue();

        // 새로고침으로 돌아온다 — 같은 세션 토큰, 새 소켓.
        WebSocketSession second = sessionWithPlayer("player-a-again");
        handler.handle(second, joinMessage("token-a", "rejoin-a"));

        assertThat(roomCloseScheduler.isPending("room-a")).isFalse();
        verify(roomService, never()).close(any());
        // 끊어둔 마감 타이머를 다시 걸어야 남은 라운드가 진행된다.
        verify(roundTimerService).start(eq("room-a"), argThat(state -> state.roundNumber() == 1));
        assertThat(roundStateStore.findByRoomId("room-a")).isPresent();
    }

    @Test
    void keepsTheRoomWhileAnotherPlayerIsStillConnected() throws Exception {
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        WebSocketSession playerA = sessionWithPlayer("player-a");
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerA, "player-a", "Player A");
        registry.join("room-a", playerB, "player-b", "Player B");
        broadcaster.register("room-a", playerA);
        broadcaster.register("room-a", playerB);

        handler.afterConnectionClosed(playerA, CloseStatus.NORMAL);

        assertThat(roomCloseScheduler.isPending("room-a")).isFalse();
        verify(roundTimerService, never()).cancelRoom(any());
        verify(roomService, never()).close(any());
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
                heartbeatMonitor,
                userService,
                scoreRoundSubmissionService,
                roundSynchronizationService,
                roundTimerService,
                roomService,
                roomCloseScheduler,
                reconnectSnapshotService
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

    @Test
    void reconnectsPlayingMemberWithGameSnapshotAndReplacesPreviousSocket() throws Exception {
        UserService userService = mock(UserService.class);
        handler = handlerWith(userService);
        when(userService.authenticateSession("token-a"))
                .thenReturn(new UserIdentity("player-a", "Player A", UserType.GUEST));

        WebSocketSession oldSession = session("old-session");
        WebSocketSession newSession = session("new-session");
        registry.join("room-a", oldSession, "player-a", "Player A");
        registry.markPhase("room-a", com.ssafy.yorr.ws.dto.RoomPhase.PLAYING);
        broadcaster.register("room-a", oldSession);

        var game = new GameState(
                3,
                "player-a",
                1_800_000_000_000L,
                Map.of("player-a", new ScoreBoard(Map.of("ones", 3), 3, 0, 3)),
                List.of("player-a"),
                2,
                List.of(6, 6, 3, 2, 1),
                List.of(true, true, false, false, false)
        );
        var reconnectSnapshot = new com.ssafy.yorr.ws.dto.RoomSnapshot(
                "room-a",
                com.ssafy.yorr.ws.dto.RoomPhase.PLAYING,
                "player-a",
                List.of(),
                game
        );
        when(reconnectSnapshotService.snapshot("room-a", "player-a"))
                .thenReturn(reconnectSnapshot);

        handler.handle(newSession, joinMessage("token-a", "reconnect-a"));

        ArgumentCaptor<WebSocketMessage<?>> oldCaptor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(oldSession).sendMessage(oldCaptor.capture());
        assertThat(((TextMessage) oldCaptor.getValue()).getPayload())
                .contains("\"type\":\"sys.disconnect\"")
                .contains("\"reason\":\"replaced_by_new_session\"");
        verify(oldSession).close(CloseStatus.POLICY_VIOLATION);

        ArgumentCaptor<WebSocketMessage<?>> newCaptor = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(newSession, times(2)).sendMessage(newCaptor.capture());
        assertThat(newCaptor.getAllValues().stream()
                .map(message -> ((TextMessage) message).getPayload())
                .toList())
                .anyMatch(json -> json.contains("\"type\":\"sys.reconnected\"")
                        && json.contains("\"roundNumber\":3")
                        && json.contains("\"activePlayerId\":\"player-a\"")
                        && json.contains("\"scores\""))
                .anyMatch(json -> json.contains("\"type\":\"presence.update\"")
                        && json.contains("\"status\":\"online\""));
        assertThat(registry.of(oldSession)).isNull();
        assertThat(registry.of(newSession).playerId()).isEqualTo("player-a");
    }

    @Test
    void rejectsNewPlayerJoiningAnActiveGame() throws Exception {
        UserService userService = mock(UserService.class);
        handler = handlerWith(userService);
        when(userService.authenticateSession("token-b"))
                .thenReturn(new UserIdentity("player-b", "Player B", UserType.GUEST));
        registry.join("room-a", session("existing-session"), "player-a", "Player A");
        registry.markPhase("room-a", com.ssafy.yorr.ws.dto.RoomPhase.PLAYING);

        WebSocketSession newcomer = session("newcomer-session");
        handler.handle(newcomer, joinMessage("token-b", "join-active"));

        String response = singleResponse(newcomer);
        assertThat(response).contains("\"code\":\"GAME_ALREADY_STARTED\"");
        assertThat(registry.of(newcomer)).isNull();
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

    @Test
    void keepsPlayingMemberOfflineAndBroadcastsPresenceOnUnexpectedClose() throws Exception {
        WebSocketSession playerA = sessionWithPlayer("player-a");
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerA, "player-a", "Player A");
        registry.join("room-a", playerB, "player-b", "Player B");
        registry.markPhase("room-a", com.ssafy.yorr.ws.dto.RoomPhase.PLAYING);
        roundSynchronizationService.initialize("room-a", 1, List.of("player-a", "player-b"));
        broadcaster.register("room-a", playerA);
        broadcaster.register("room-a", playerB);

        handler.afterConnectionClosed(playerA, CloseStatus.NORMAL);

        assertThat(registry.snapshot("room-a").players()).hasSize(2);
        assertThat(registry.snapshot("room-a").players())
                .filteredOn(player -> player.playerId().equals("player-a"))
                .singleElement()
                .satisfies(player ->
                        assertThat(player.status())
                                .isEqualTo(com.ssafy.yorr.ws.dto.PlayerStatus.OFFLINE));
        String response = singleResponse(playerB);
        assertThat(response).contains("\"type\":\"presence.update\"");
        assertThat(response).contains("\"playerId\":\"player-a\"");
        assertThat(response).contains("\"status\":\"offline\"");
        assertThat(response).doesNotContain("room.player_left");
        verify(roundTimerService, never()).cancelRoom("room-a");
        assertThat(roundStateStore.findByRoomId("room-a")).isPresent();
    }

    @Test
    void removesWaitingMemberOnUnexpectedClose() throws Exception {
        WebSocketSession playerA = sessionWithPlayer("player-a");
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerA, "player-a", "Player A");
        registry.join("room-a", playerB, "player-b", "Player B");
        broadcaster.register("room-a", playerA);
        broadcaster.register("room-a", playerB);

        handler.afterConnectionClosed(playerA, CloseStatus.NORMAL);

        assertThat(registry.snapshot("room-a").players())
                .extracting(player -> player.playerId())
                .containsExactly("player-b");
        assertThat(singleResponse(playerB)).contains("\"type\":\"room.player_left\"");
    }

    @Test
    void explicitLeaveStillRemovesPlayingMember() throws Exception {
        WebSocketSession playerA = sessionWithPlayer("player-a");
        WebSocketSession playerB = sessionWithPlayer("player-b");
        registry.join("room-a", playerA, "player-a", "Player A");
        registry.join("room-a", playerB, "player-b", "Player B");
        registry.markPhase("room-a", com.ssafy.yorr.ws.dto.RoomPhase.PLAYING);
        broadcaster.register("room-a", playerA);
        broadcaster.register("room-a", playerB);

        handler.handle(playerA, leaveMessage());

        assertThat(registry.snapshot("room-a").players())
                .extracting(player -> player.playerId())
                .containsExactly("player-b");
        assertThat(singleResponse(playerB)).contains("\"type\":\"room.player_left\"");
    }

    @Test
    void heartbeatTimeoutSendsReasonBeforeClosingTheSocket() throws Exception {
        WebSocketSession session = sessionWithPlayer("player-a");
        handler.afterConnectionEstablished(session);
        ArgumentCaptor<Runnable> timeout = ArgumentCaptor.forClass(Runnable.class);
        verify(heartbeatMonitor).track(eq(session), timeout.capture());
        clearInvocations(session);

        timeout.getValue().run();

        String response = singleResponse(session);
        assertThat(response).contains("\"type\":\"sys.disconnect\"");
        assertThat(response).contains("\"reason\":\"idle_timeout\"");
        verify(session).close(CloseStatus.POLICY_VIOLATION);
    }

    @Test
    void recordsEachPingBeforeSendingPong() throws Exception {
        WebSocketSession session = sessionWithPlayer("player-a");

        handler.handle(session, pingMessage());

        verify(heartbeatMonitor).recordPing(session);
        assertThat(singleResponse(session)).contains("\"type\":\"sys.pong\"");
    }

    private TestGameWebSocketHandler handlerWith(UserService userService) {
        return new TestGameWebSocketHandler(
                objectMapper,
                broadcaster,
                registry,
                heartbeatMonitor,
                userService,
                scoreRoundSubmissionService,
                roundSynchronizationService,
                roundTimerService,
                roomService,
                roomCloseScheduler,
                reconnectSnapshotService
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

    private TextMessage leaveMessage() throws Exception {
        return new TextMessage(objectMapper.writeValueAsString(new WsEnvelope<>(
                "room.leave",
                System.currentTimeMillis(),
                Map.of(),
                "room-a",
                "leave-a"
        )));
    }

    private TextMessage pingMessage() throws Exception {
        return new TextMessage(objectMapper.writeValueAsString(new WsEnvelope<>(
                "sys.ping",
                System.currentTimeMillis(),
                Map.of("clientTs", System.currentTimeMillis()),
                null,
                "ping-a"
        )));
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
        return session(playerId + "-session");
    }

    private static WebSocketSession session(String sessionId) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(sessionId);
        when(session.getAttributes()).thenReturn(new HashMap<>());
        when(session.isOpen()).thenReturn(true);
        return session;
    }

    /** 유예를 실시간으로 기다리지 않고 원할 때 터뜨린다. */
    private static final class FakeRoomCloseScheduler implements RoomCloseScheduler {

        private final Map<String, Runnable> pending = new HashMap<>();
        private Duration lastDelay;

        @Override
        public void schedule(String roomId, Duration delay, Runnable closeTask) {
            lastDelay = delay;
            pending.put(roomId, closeTask);
        }

        @Override
        public boolean cancel(String roomId) {
            return pending.remove(roomId) != null;
        }

        boolean isPending(String roomId) {
            return pending.containsKey(roomId);
        }

        void fire(String roomId) {
            Runnable task = pending.remove(roomId);
            if (task != null) {
                task.run();
            }
        }
    }

    private static class TestGameWebSocketHandler extends GameWebSocketHandler {

        TestGameWebSocketHandler(
                ObjectMapper objectMapper,
                InMemoryRoomBroadcaster broadcaster,
                RoomSessionRegistry registry,
                HeartbeatMonitor heartbeatMonitor,
                UserService userService,
                ScoreRoundSubmissionService scoreRoundSubmissionService,
                RoundSynchronizationService roundSynchronizationService,
                RoundTimerService roundTimerService,
                RoomService roomService,
                RoomCloseScheduler roomCloseScheduler,
                GameReconnectSnapshotService reconnectSnapshotService
        ) {
            super(
                    objectMapper,
                    broadcaster,
                    registry,
                    heartbeatMonitor,
                    userService,
                    scoreRoundSubmissionService,
                    roundSynchronizationService,
                    roundTimerService,
                    roomService,
                    roomCloseScheduler,
                    reconnectSnapshotService
            );
        }

        void handle(WebSocketSession session, TextMessage message) throws Exception {
            handleTextMessage(session, message);
        }
    }
}
