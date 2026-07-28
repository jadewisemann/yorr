package com.ssafy.yorr.handler;

import com.ssafy.yorr.ws.InMemoryRoomBroadcaster;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.ssafy.yorr.user.dto.GuestCreateResponse;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionResult;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionService;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.application.RoundTimerService;
import com.ssafy.yorr.game.round.domain.RoundCompletion;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.game.round.domain.RoundSynchronizationException;
import com.ssafy.yorr.ws.WsProtocol;
import com.ssafy.yorr.ws.dto.InboundEnvelope;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import com.ssafy.yorr.ws.dto.SysConnectedPayload;
import com.ssafy.yorr.ws.dto.SysPongPayload;
import com.ssafy.yorr.ws.dto.ErrorPayload;
import com.ssafy.yorr.ws.dto.RoundEndPayload;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import com.ssafy.yorr.ws.dto.ScoreUpdatePayload;
import com.ssafy.yorr.ws.dto.WsErrorCode;
import com.ssafy.yorr.ws.dto.RoomJoinPayload;
import com.ssafy.yorr.ws.dto.RoomJoinedPayload;
import com.ssafy.yorr.ws.dto.RoomPlayerJoinedPayload;
import com.ssafy.yorr.ws.dto.RoomPlayerLeftPayload;
import com.ssafy.yorr.ws.dto.RoomReadyPayload;
import com.ssafy.yorr.ws.dto.RoomReadyChangedPayload;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import com.ssafy.yorr.ws.dto.PlayerStatus;
import com.ssafy.yorr.ws.dto.PresenceUpdatePayload;
import com.ssafy.yorr.ws.dto.ReactionSendPayload;
import com.ssafy.yorr.ws.dto.ReactionBroadcastPayload;
import com.ssafy.yorr.ws.dto.StateSyncPayload;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import tools.jackson.databind.ObjectMapper;   // ← Jackson 3 (Boot 4)

import java.io.IOException;

@Component
public class GameWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(GameWebSocketHandler.class);
    private final ObjectMapper objectMapper; // Boot4가 만드는 JsonMapper 빈이 여기 주입됨
    private final InMemoryRoomBroadcaster broadcaster;
    private final RoomSessionRegistry registry; // 방 명단(누가 어느 방에)
    private final UserService userService;      // 게스트 정체성 발급(티켓 70 재사용)
    private final ScoreRoundSubmissionService scoreRoundSubmissionService;
    private final RoundSynchronizationService roundSynchronizationService;
    private final RoundTimerService roundTimerService;

    public GameWebSocketHandler(ObjectMapper objectMapper,
                                InMemoryRoomBroadcaster broadcaster,
                                RoomSessionRegistry registry,
                                UserService userService,
                                ScoreRoundSubmissionService scoreRoundSubmissionService,
                                RoundSynchronizationService roundSynchronizationService,
                                RoundTimerService roundTimerService) {
        this.objectMapper = objectMapper;
        this.broadcaster = broadcaster;
        this.registry = registry;
        this.userService = userService;
        this.scoreRoundSubmissionService = scoreRoundSubmissionService;
        this.roundSynchronizationService = roundSynchronizationService;
        this.roundTimerService = roundTimerService;
    }

    // 연결이 열렸을 때 (콜센터: 전화 받음)
    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        log.info("연결 열림: {}", session.getId());

        // 인증(room.join) 전에 먼저 보내는 서버 인사. 손으로 쓰던 JSON을 DTO + Jackson으로 교체.
        WsEnvelope<SysConnectedPayload> connected = WsEnvelope.of(
                "sys.connected",
                new SysConnectedPayload(
                        System.currentTimeMillis(),
                        WsProtocol.PROTOCOL_VERSION,
                        WsProtocol.HEARTBEAT_INTERVAL_MS));
        send(session, connected);
    }

    // 클라이언트가 메시지를 보냈을 때 (콜센터: 손님 말 들음)
    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        // 1) 봉투만 먼저 파싱 (payload는 JsonNode로 남겨둠)
        InboundEnvelope in;
        try {
            in = objectMapper.readValue(message.getPayload(), InboundEnvelope.class);
        } catch (Exception e) {
            log.warn("깨진 WS 메시지: {}", message.getPayload(), e);
            sendError(session, WsErrorCode.INVALID_MESSAGE, "메시지 형식이 올바르지 않습니다.", null);
            return;
        }

        // 2) 봉투 라벨(type)만 보고 담당 핸들러로 배달
        switch (in.type()) {
            case "sys.ping"   -> handleSysPing(session, in);
            case "room.join"  -> handleRoomJoin(session, in);
            case "room.leave" -> handleRoomLeave(session, in);
            case "room.ready" -> handleRoomReady(session, in);
            case "reaction.send" -> handleReactionSend(session, in);
            case "dice.roll" -> handleDiceRoll(session, in);
            case "round.submit" -> handleRoundSubmit(session, in);
            // 다음 슬라이스에서 하나씩 (레지스트리·브로드캐스터는 이미 준비됨):
            //   case "sys.reconnect" -> handleSysReconnect(session, in);   // 상태 복원(25번 티켓, 박재영)과 공동
            default -> log.debug("아직 라우팅 안 붙은 type: {}", in.type());
        }
    }

    /**
     * room.join = 인증(게스트 발급) + 방 입장 통합. 소켓 열고 보내는 사실상 첫 메시지.
     * 순서가 중요하다: (1) 명단 등록 → (2) 본인에게 room.joined → (3) 기존 멤버에게 player_joined
     * → (4) 마지막에 팬아웃 등록. (3)을 (4)보다 먼저 해서 "본인이 자기 입장 소식을 중복 수신"하는 걸 막는다.
     */
    private void handleRoomJoin(WebSocketSession session, InboundEnvelope in) throws IOException {
        // payload 파싱 (봉투는 이미 열렸고, 여기서 room.join 전용 payload만 변환)
        RoomJoinPayload payload;
        try {
            payload = objectMapper.treeToValue(in.payload(), RoomJoinPayload.class);
        } catch (Exception e) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "room.join payload가 올바르지 않습니다.", in.msgId());
            return;
        }
        if (payload == null || payload.roomId() == null || payload.roomId().isBlank()) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "roomId가 필요합니다.", in.msgId());
            return;
        }

        // --- 정체성 확정 (seam: resolveIdentity 하나로 격리 — 재접속 구현 시 여기만 교체) ---
        final Identity id;
        try {
            id = resolveIdentity(payload);
        } catch (IllegalArgumentException e) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "닉네임이 올바르지 않습니다.", in.msgId());
            return;
        }

        // (1) 명단 등록 (첫 입장자 = host). self엔 확정된 host 여부가 들어있음.
        RoomSessionRegistry.Member self = registry.join(payload.roomId(), session, id.playerId(), id.nickname());
        RoomSnapshot snapshot = registry.snapshot(payload.roomId()); // 본인 포함 전체 명단

        // (2) 본인에게: room.joined (발급 playerId·세션토큰·전체 스냅샷). 본인에게만.
        send(session, WsEnvelope.of("room.joined",
                        new RoomJoinedPayload(id.playerId(), id.sessionToken(), snapshot))
                .withRoomId(payload.roomId()));

        // (3) 기존 멤버에게만: room.player_joined (본인은 아직 팬아웃 미등록 → 안 받음)
        //     접속 자체는 player_joined(Player.status 포함)가 알리므로 여기서 presence는 쏘지 않는다.
        broadcaster.broadcast(payload.roomId(), WsEnvelope.of("room.player_joined",
                        new RoomPlayerJoinedPayload(self.toPlayer()))
                .withRoomId(payload.roomId()));

        // (4) 이제 팬아웃 대상에 본인 등록 → 이후 방 브로드캐스트 수신
        broadcaster.register(payload.roomId(), session);
        log.info("room.join: player={} room={} host={}", id.playerId(), payload.roomId(), self.host());
    }

    /**
     * room.join 정체성 확정 seam — 이 메서드 하나만 교체하면 재접속 등 정책을 갈아끼울 수 있다.
     * <p>
     * 현재(happy path): sessionToken 없음 → 게스트 식별(티켓 70) UserService로 신규 발급.
     * (계약 v0.2: token 없으면 서버가 신규 발급. UserService 재사용으로 정체성 체계 이원화 방지.)
     * <p>
     * ⚠️ TODO(티켓 25 재접속 · 박재영 공동): sessionToken 재사용(resume) 경로 이관.
     *    방향 = Redis에 token→userId 역인덱스(옵션 b)로 복원. **계약(RoomJoinPayload)엔 userId 추가하지 않음.**
     *    지금은 token 유무와 무관하게 항상 신규 게스트를 발급한다.
     *
     * @throws IllegalArgumentException 닉네임이 유효하지 않을 때(UserService 규칙)
     */
    private Identity resolveIdentity(RoomJoinPayload payload) {
        if (payload.sessionToken() != null && !payload.sessionToken().isBlank()) {
            var user = userService.authenticateSession(payload.sessionToken());
            return new Identity(user.userId(), payload.sessionToken(), user.nickname());
        }
        GuestCreateResponse guest = userService.createGuest(payload.nickname());
        return new Identity(guest.userId(), guest.sessionToken(), guest.nickname());
    }

    /** room.join으로 확정된 정체성(발급 playerId·세션토큰·정규화 닉네임). */
    private record Identity(String playerId, String sessionToken, String nickname) {}

    // 연결이 닫혔을 때 (콜센터: 전화 끊김)
    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        log.info("연결 닫힘: {} / {}", session.getId(), status);
        leaveRoom(session); // 명단·팬아웃 정리 + 남은 멤버에게 player_left
    }

    /**
     * room.leave = 방 퇴장(payload 없음, 대상 방은 서버가 이미 앎). 소켓 자체는 유지한다.
     * 명단 제거 + player_left 브로드캐스트는 소켓 종료와 동일하므로 {@link #leaveRoom}을 공유한다.
     */
    private void handleRoomLeave(WebSocketSession session, InboundEnvelope in) {
        leaveRoom(session);
    }

    /**
     * room.ready = 대기방 준비 토글. 방 전원에게 room.ready_changed 브로드캐스트.
     * 서버가 authoritative라 본인도 포함해 쏜다(본인은 서버 확인 이벤트로 자기 UI 갱신).
     */
    private void handleRoomReady(WebSocketSession session, InboundEnvelope in) throws IOException {
        RoomReadyPayload payload;
        try {
            payload = objectMapper.treeToValue(in.payload(), RoomReadyPayload.class);
        } catch (Exception e) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "room.ready payload가 올바르지 않습니다.", in.msgId());
            return;
        }
        RoomSessionRegistry.Member me = registry.of(session);
        if (me == null) {
            sendError(session, WsErrorCode.NOT_IN_ROOM, "방에 입장한 뒤에만 준비할 수 있습니다.", in.msgId());
            return;
        }
        broadcaster.broadcast(me.roomId(), WsEnvelope.of("room.ready_changed",
                        new RoomReadyChangedPayload(me.playerId(), payload.ready()))
                .withRoomId(me.roomId()));
    }

    /**
     * reaction.send → reaction.broadcast. 방 전원(본인 포함)에게 "누가 무슨 리액션을 보냈는지" 뿌린다.
     * 리액션은 보낸 본인도 확인 겸 받는 게 자연스러워 자기 세션도 포함해 방송한다.
     */
    private void handleReactionSend(WebSocketSession session, InboundEnvelope in) throws IOException {
        ReactionSendPayload payload;
        try {
            payload = objectMapper.treeToValue(in.payload(), ReactionSendPayload.class);
        } catch (Exception e) {
            // 알 수 없는 reaction 값이면 ReactionType 역직렬화에서 여기로 떨어진다.
            sendError(session, WsErrorCode.INVALID_MESSAGE, "reaction.send payload가 올바르지 않습니다.", in.msgId());
            return;
        }
        if (payload == null || payload.reaction() == null) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "reaction 종류가 필요합니다.", in.msgId());
            return;
        }
        RoomSessionRegistry.Member me = registry.of(session);
        if (me == null) {
            sendError(session, WsErrorCode.NOT_IN_ROOM, "방에 입장한 뒤에만 리액션을 보낼 수 있습니다.", in.msgId());
            return;
        }
        broadcaster.broadcast(me.roomId(), WsEnvelope.of("reaction.broadcast",
                        new ReactionBroadcastPayload(me.playerId(), payload.reaction()))
                .withRoomId(me.roomId()));
    }

    /** 방 이탈 공통 처리: 명단 제거 → 팬아웃 제거 → 남은 멤버에게 player_left. room.leave·소켓 종료가 공유. */
    private void leaveRoom(WebSocketSession session) {
        RoomSessionRegistry.Member gone = registry.remove(session);
        broadcaster.unregister(session); // 본인을 팬아웃에서 뺀 뒤 브로드캐스트 → 본인은 안 받음
        if (gone != null) {
            broadcaster.broadcast(gone.roomId(), WsEnvelope.of("room.player_left",
                            new RoomPlayerLeftPayload(gone.playerId()))
                    .withRoomId(gone.roomId()));
        }
    }

    /**
     * presence.update 브로드캐스트: 플레이어의 접속 상태(online/away/offline) "전이"를 방에 알림.
     * <p>
     * 입장/퇴장 자체는 player_joined(status 포함)/player_left가 커버하므로 여기서 발화하지 않는다.
     * 재접속·유휴 감지(티켓 25)가 online↔away↔offline 전이 시 호출하는 진입점이다. (현재 in-repo 호출자 없음)
     */
    public void broadcastPresence(String roomId, String playerId, PlayerStatus status) {
        broadcaster.broadcast(roomId, WsEnvelope.of("presence.update",
                        new PresenceUpdatePayload(playerId, status))
                .withRoomId(roomId));
    }

    /**
     * state.sync: 방 전체 스냅샷을 방에 브로드캐스트(계약 MVP 권장 = state.patch 대신 전체 스냅샷).
     * <p>
     * 대기방 명단 변화는 granular 이벤트(player_joined/left · presence.update)로 이미 커버되므로
     * 로비에서는 자동 발화하지 않는다. 게임 상태(RoomSnapshot.game)가 바뀌는 라운드/점수 도메인
     * (티켓 23·28·41)이 "전체 상태 재동기화"가 필요할 때 호출하는 진입점이다.
     */
    public void broadcastStateSync(String roomId) {
        broadcaster.broadcast(roomId, WsEnvelope.of("state.sync",
                        new StateSyncPayload(registry.snapshot(roomId)))
                .withRoomId(roomId));
    }

    /** sys.ping → sys.pong. pong은 서버 시각만 돌려주면 됨. */
    private void handleSysPing(WebSocketSession session, InboundEnvelope in) throws IOException {
        // ping의 clientTs는 클라가 RTT/시계오프셋 계산에 씀 → 서버는 안 봐도 OK
        WsEnvelope<SysPongPayload> pong =
                WsEnvelope.of("sys.pong", new SysPongPayload(System.currentTimeMillis()));
        send(session, pong);
    }

    /** round.submit → 점수 브로드캐스트 후 다음 플레이어 턴 시작. 마지막 플레이어면 round.end도 전송한다. */
    private void handleRoundSubmit(WebSocketSession session, InboundEnvelope in) throws IOException {
        String roomId = in.roomId();
        if (roomId == null || roomId.isBlank()) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "roomId가 필요합니다.", in.msgId());
            return;
        }

        RoomSessionRegistry.Member member = registry.of(session);
        if (member == null) {
            sendError(session, WsErrorCode.AUTH_REQUIRED, "인증된 플레이어 정보가 없습니다.", in.msgId());
            return;
        }
        if (!roomId.equals(member.roomId())) {
            sendError(session, WsErrorCode.NOT_IN_ROOM, "현재 세션이 참가한 방의 요청이 아닙니다.", in.msgId());
            return;
        }
        String playerId = member.playerId();

        RoundSubmitPayload payload;
        try {
            payload = objectMapper.treeToValue(in.payload(), RoundSubmitPayload.class);
        } catch (Exception e) {
            log.warn("round.submit payload 파싱 실패: {}", in.payload(), e);
            sendError(session, WsErrorCode.INVALID_MESSAGE, "round.submit payload 형식이 올바르지 않습니다.", in.msgId());
            return;
        }

        try {
            ScoreRoundSubmissionResult result = scoreRoundSubmissionService.submit(roomId, playerId, payload);
            broadcastScoreUpdate(roomId, result, in.msgId());
            RoundSubmissionResult roundResult = result.round();
            roundTimerService.cancel(roomId, payload.roundNumber());
            if (roundResult.roundCompleted()) {
                RoundCompletion completion = roundResult.completion().orElseThrow();
                broadcastRoundEnd(roomId, completion);
            }
            roundTimerService.start(
                    roomId,
                    roundResult.state().roundNumber(),
                    roundResult.state().activePlayerId()
            );
        } catch (ScoreConfirmationException e) {
            sendError(session, toWsErrorCode(e.reason()), e.getMessage(), in.msgId());
        } catch (RoundSynchronizationException e) {
            sendError(session, toWsErrorCode(e.reason()), e.getMessage(), in.msgId());
        } catch (IllegalArgumentException e) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, e.getMessage(), in.msgId());
        }
    }

    private void handleDiceRoll(WebSocketSession session, InboundEnvelope in) throws IOException {
        String roomId = in.roomId();
        RoomSessionRegistry.Member member = registry.of(session);
        if (roomId == null || roomId.isBlank() || member == null || !roomId.equals(member.roomId())) {
            sendError(session, WsErrorCode.NOT_IN_ROOM, "current room membership is required", in.msgId());
            return;
        }

        DiceRollPayload payload;
        try {
            payload = objectMapper.treeToValue(in.payload(), DiceRollPayload.class);
        } catch (Exception exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "invalid dice.roll payload", in.msgId());
            return;
        }

        try {
            var state = roundSynchronizationService.recordRoll(roomId, member.playerId(), payload);
            roundTimerService.start(roomId, state.roundNumber(), state.activePlayerId());
        } catch (RoundSynchronizationException exception) {
            sendError(session, toWsErrorCode(exception.reason()), exception.getMessage(), in.msgId());
        } catch (IllegalArgumentException exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, exception.getMessage(), in.msgId());
        }
    }

    private void broadcastScoreUpdate(
            String roomId,
            ScoreRoundSubmissionResult result,
            String requestMessageId
    ) {
        broadcaster.broadcast(
                roomId,
                WsEnvelope.of(
                                "score.update",
                                new ScoreUpdatePayload(
                                        result.score().playerId(),
                                        result.score().scoreboard()
                                )
                        )
                        .withRoomId(roomId)
                        .withMsgId(requestMessageId)
        );
    }

    private void broadcastRoundEnd(
            String roomId,
            RoundCompletion completion
    ) {
        WsEnvelope<RoundEndPayload> roundEnd = new WsEnvelope<>(
                "round.end",
                System.currentTimeMillis(),
                new RoundEndPayload(completion.roundNumber(), completion.submittedPlayerIds()),
                roomId,
                null
        );
        broadcaster.broadcast(roomId, roundEnd);
    }

    private static WsErrorCode toWsErrorCode(RoundSynchronizationException.Reason reason) {
        return switch (reason) {
            case PLAYER_NOT_IN_ROUND -> WsErrorCode.NOT_IN_ROOM;
            case INVALID_ROUND,
                 INVALID_PLAYER,
                 INVALID_DICE,
                 INVALID_ROLL,
                 INVALID_CATEGORY,
                 ROUND_ALREADY_INITIALIZED,
                 ROUND_MISMATCH,
                 NOT_ACTIVE_PLAYER,
                 ALREADY_SUBMITTED -> WsErrorCode.INVALID_MESSAGE;
            case ROUND_NOT_INITIALIZED -> WsErrorCode.INTERNAL;
        };
    }

    private static WsErrorCode toWsErrorCode(ScoreConfirmationException.Reason reason) {
        return switch (reason) {
            case INVALID_CATEGORY,
                 INVALID_DICE,
                 GAME_NOT_ACTIVE,
                 ROUND_ALREADY_SCORED,
                 CATEGORY_ALREADY_USED -> WsErrorCode.INVALID_MESSAGE;
            case GAME_NOT_FOUND -> WsErrorCode.ROOM_NOT_FOUND;
            case PLAYER_NOT_IN_GAME -> WsErrorCode.NOT_IN_ROOM;
            case STORE_FAILURE -> WsErrorCode.INTERNAL;
        };
    }

    /** 공통 송신 헬퍼: 봉투 → JSON 문자열 → 소켓 전송. */
    private void send(WebSocketSession session, WsEnvelope<?> envelope) throws IOException {
        String json = objectMapper.writeValueAsString(envelope);
        synchronized (session) {
            session.sendMessage(new TextMessage(json));
        }
    }

    /** 표준 에러 응답. refMsgId =  어떤 요청 실패인지 매칭용(없으면 null). **/
    private void sendError(WebSocketSession session, WsErrorCode code, String message, String refMsgID) throws IOException{
        send(session, WsEnvelope.of("error", new ErrorPayload(code, message, refMsgID, null)));
    }
}
