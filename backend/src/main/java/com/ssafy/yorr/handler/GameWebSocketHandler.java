package com.ssafy.yorr.handler;

import com.ssafy.yorr.ws.InMemoryRoomBroadcaster;
import com.ssafy.yorr.ws.HeartbeatMonitor;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.dto.GuestCreateResponse;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionResult;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionService;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.application.RoundTimerService;
import com.ssafy.yorr.game.round.application.GameReconnectSnapshotService;
import com.ssafy.yorr.game.round.domain.RoundSynchronizationException;
import com.ssafy.yorr.ws.WsProtocol;
import com.ssafy.yorr.ws.dto.InboundEnvelope;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import com.ssafy.yorr.ws.dto.SysConnectedPayload;
import com.ssafy.yorr.ws.dto.SysPongPayload;
import com.ssafy.yorr.ws.dto.ErrorPayload;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import com.ssafy.yorr.ws.dto.DiceBroadcastPayload;
import com.ssafy.yorr.ws.dto.DiceHoldPayload;
import com.ssafy.yorr.ws.dto.DiceHoldChangedPayload;
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
import com.ssafy.yorr.ws.dto.DisconnectReason;
import com.ssafy.yorr.ws.dto.SysDisconnectPayload;
import com.ssafy.yorr.ws.dto.SysReconnectedPayload;
import com.ssafy.yorr.ws.dto.RoomPhase;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import tools.jackson.databind.ObjectMapper;   // ← Jackson 3 (Boot 4)

import com.ssafy.yorr.room.port.RoomCloseScheduler;
import com.ssafy.yorr.room.service.RoomService;

import java.io.IOException;
import java.time.Duration;

@Component
public class GameWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(GameWebSocketHandler.class);
    private final ObjectMapper objectMapper; // Boot4가 만드는 JsonMapper 빈이 여기 주입됨
    private final InMemoryRoomBroadcaster broadcaster;
    private final RoomSessionRegistry registry; // 방 명단(누가 어느 방에)
    private final HeartbeatMonitor heartbeatMonitor;
    private final UserService userService;      // 게스트 정체성 발급(티켓 70 재사용)
    private final ScoreRoundSubmissionService scoreRoundSubmissionService;
    private final RoundSynchronizationService roundSynchronizationService;
    private final RoundTimerService roundTimerService;
    private final RoomService roomService;                     // 빈 방 닫기(Redis 키 정리)
    private final RoomCloseScheduler roomCloseScheduler;       // 유예 뒤 닫기 예약

    /**
     * 마지막 참가자의 소켓이 끊긴 뒤 <b>대기실</b>을 닫기까지 기다리는 시간.
     * <p>
     * 새로고침·터널 통과 같은 짧은 단절은 소켓을 끊고 다시 연결한다. 즉시 닫으면 본인이 자기
     * 방을 파괴하므로, 그 왕복이 끝날 만큼만 준다. 대기실은 잃을 진행 상태가 없어 짧게 준다.
     */
    static final Duration EMPTY_LOBBY_GRACE = Duration.ofSeconds(30);
    /**
     * <b>진행 중인 게임</b>이 비었을 때의 유예. 대기실보다 훨씬 길게 준다.
     * <p>
     * 여기서 방을 닫으면 점수판·라운드 진행처럼 되돌릴 수 없는 값이 사라진다. 모바일에서
     * 앱 전환·화면 잠금·전화 수신은 30초를 쉽게 넘기므로 대기실 기준의 시간을 그대로 쓰면
     * 잠깐 화면을 벗어난 사람의 게임을 서버가 스스로 파괴한다(S15P11A406-136). 재접속 상태
     * 복원(S15P11A406-113)이 복원하려는 대상을 서버가 먼저 지워버리는 모순이기도 하다.
     * <p>
     * 방 자체의 TTL(40분)이 상한이므로 그보다 길게 잡을 이유는 없다.
     */
    static final Duration ACTIVE_GAME_GRACE = Duration.ofMinutes(10);
    private final GameReconnectSnapshotService reconnectSnapshotService;

    public GameWebSocketHandler(ObjectMapper objectMapper,
                                InMemoryRoomBroadcaster broadcaster,
                                RoomSessionRegistry registry,
                                HeartbeatMonitor heartbeatMonitor,
                                UserService userService,
                                ScoreRoundSubmissionService scoreRoundSubmissionService,
                                RoundSynchronizationService roundSynchronizationService,
                                RoundTimerService roundTimerService,
                                RoomService roomService,
                                RoomCloseScheduler roomCloseScheduler,
                                GameReconnectSnapshotService reconnectSnapshotService) {
        this.objectMapper = objectMapper;
        this.broadcaster = broadcaster;
        this.registry = registry;
        this.heartbeatMonitor = heartbeatMonitor;
        this.userService = userService;
        this.scoreRoundSubmissionService = scoreRoundSubmissionService;
        this.roundSynchronizationService = roundSynchronizationService;
        this.roundTimerService = roundTimerService;
        this.roomService = roomService;
        this.roomCloseScheduler = roomCloseScheduler;
        this.reconnectSnapshotService = reconnectSnapshotService;
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
        heartbeatMonitor.track(session, () -> disconnectIdleSession(session));
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
            case "dice.hold" -> handleDiceHold(session, in);
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

        // 방 존재의 권위는 Redis다. 이 검사가 없으면 이미 닫힌 방에도 입장이 되고, 메모리에만
        // 존재하는 유령 방이 만들어진다 — 사용자는 대기실 화면에 앉아 있는데 게임 시작이 404로
        // 실패하는 막힌 상태가 된다(S15P11A406-136). 틀린 화면보다 정직한 실패가 낫다.
        if (roomIsGone(payload.roomId())) {
            sendError(session, WsErrorCode.ROOM_NOT_FOUND,
                    "방이 종료됐습니다. 홈에서 새로 시작해 주세요.", in.msgId());
            return;
        }

        // --- 정체성 확정 (seam: resolveIdentity 하나로 격리 — 재접속 구현 시 여기만 교체) ---
        final Identity id;
        try {
            id = resolveIdentity(payload);
        } catch (SessionAuthenticationException e) {
            // 토큰 만료·불일치. INVALID_MESSAGE로 뭉개면 클라가 세션 종료로 다루지 않아
            // 대기실에서 안내 없이 멈춘다 — 전용 코드를 줘야 재입장 복구 경로가 돈다.
            sendError(session, WsErrorCode.SESSION_EXPIRED,
                    "입장 정보가 만료됐습니다. 방에 다시 참가해 주세요.", in.msgId());
            return;
        } catch (IllegalArgumentException e) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "닉네임이 올바르지 않습니다.", in.msgId());
            return;
        }

        RoomSessionRegistry.Member previous = registry.find(payload.roomId(), id.playerId());
        boolean reconnecting = previous != null;
        if (registry.phaseOf(payload.roomId()) == RoomPhase.PLAYING && !reconnecting) {
            sendError(session, WsErrorCode.GAME_ALREADY_STARTED,
                    "이미 시작된 게임에는 새로 참가할 수 없습니다.", in.msgId());
            return;
        }

        // (1) 명단 등록. 같은 playerId면 자리와 host를 유지하고 새 소켓으로 교체한다.
        RoomSessionRegistry.Member self = registry.join(payload.roomId(), session, id.playerId(), id.nickname());
        disconnectPreviousSession(previous, session);

        if (reconnecting) {
            broadcaster.register(payload.roomId(), session);
            final RoomSnapshot snapshot;
            try {
                snapshot = reconnectSnapshotService.snapshot(payload.roomId(), id.playerId());
            } catch (RuntimeException exception) {
                log.error("재접속 상태 스냅샷 생성 실패: player={} room={}",
                        id.playerId(), payload.roomId(), exception);
                broadcaster.unregister(session);
                sendError(session, WsErrorCode.INTERNAL,
                        "게임 상태를 복원하지 못했습니다. 잠시 후 다시 시도해 주세요.", in.msgId());
                return;
            }
            send(session, WsEnvelope.of("sys.reconnected", new SysReconnectedPayload(snapshot))
                    .withRoomId(payload.roomId())
                    .withMsgId(in.msgId()));
            // 복귀했으니 오프라인 결석은 처음부터 다시 센다 — 안 지우면 한참 뒤의 짧은 끊김 한 번에 퇴장당한다.
            roundTimerService.clearOfflineMisses(payload.roomId(), id.playerId());
            broadcastPresence(payload.roomId(), id.playerId(), PlayerStatus.ONLINE);
            log.info("room.reconnected: player={} room={}", id.playerId(), payload.roomId());
            return;
        }

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

        // (5) 비어서 닫히기를 기다리던 방이면 살려낸다. 취소된 예약이 있었다 = 방금 전까지
        //     아무도 없었다는 뜻이라, 그때 끊어둔 마감 타이머를 여기서 다시 걸어준다.
        if (roomCloseScheduler.cancel(payload.roomId())) {
            resumeRoundTimer(payload.roomId());
        }
        log.info("room.join: player={} room={} host={}", id.playerId(), payload.roomId(), self.host());
    }

    /** 빈 방에서 끊어둔 마감 타이머를 복귀 시 다시 건다. 진행 중인 라운드가 없으면 아무것도 하지 않는다. */
    private void resumeRoundTimer(String roomId) {
        roundSynchronizationService.findByRoomId(roomId)
                .filter(state -> !state.isFinished())
                .ifPresent(state -> roundTimerService.start(roomId, state));
    }

    private void disconnectPreviousSession(
            RoomSessionRegistry.Member previous,
            WebSocketSession replacement
    ) {
        if (previous == null || previous.session() == null || previous.session() == replacement) {
            return;
        }
        WebSocketSession old = previous.session();
        broadcaster.unregister(old);
        try {
            if (old.isOpen()) {
                send(old, WsEnvelope.of("sys.disconnect",
                        new SysDisconnectPayload(DisconnectReason.REPLACED_BY_NEW_SESSION)));
                old.close(CloseStatus.POLICY_VIOLATION);
            }
        } catch (IOException exception) {
            log.debug("교체된 이전 소켓 정리 실패: {}", old.getId(), exception);
        }
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
     * @throws SessionAuthenticationException 세션 토큰이 만료·불일치일 때
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
        heartbeatMonitor.untrack(session);
        RoomSessionRegistry.Member member = registry.of(session);
        if (member == null) {
            broadcaster.unregister(session);
            return;
        }
        if (registry.phaseOf(member.roomId()) == com.ssafy.yorr.ws.dto.RoomPhase.PLAYING) {
            broadcaster.unregister(session);
            RoomSessionRegistry.Member offline = registry.markOffline(session);
            if (offline != null) {
                broadcastPresence(offline.roomId(), offline.playerId(), PlayerStatus.OFFLINE);
            }
            return;
        }
        leaveRoom(session);
    }

    /**
     * room.leave = 방 퇴장(payload 없음, 대상 방은 서버가 이미 앎). 소켓 자체는 유지한다.
     * 대기방에서는 명단 제거 + player_left 브로드캐스트를 소켓 종료와 {@link #leaveRoom}으로 공유한다.
     * 게임 중에는 턴 순서·Redis 명단까지 함께 정리해야 하므로 이탈 단일 경로
     * ({@link RoundTimerService#removePlayer})로 보낸다.
     */
    private void handleRoomLeave(WebSocketSession session, InboundEnvelope in) {
        RoomSessionRegistry.Member member = registry.of(session);
        if (member != null && registry.phaseOf(member.roomId()) == RoomPhase.PLAYING) {
            broadcaster.unregister(session); // 본인을 팬아웃에서 뺀 뒤 player_left가 나간다
            roundTimerService.removePlayer(member.roomId(), member.playerId());
            return;
        }
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

    /** 명시 퇴장 처리: 명단 제거 → 팬아웃 제거 → 남은 멤버에게 player_left. */
    private void leaveRoom(WebSocketSession session) {
        RoomSessionRegistry.Member gone = registry.remove(session);
        broadcaster.unregister(session); // 본인을 팬아웃에서 뺀 뒤 브로드캐스트 → 본인은 안 받음
        if (gone == null) {
            return;
        }
        broadcaster.broadcast(gone.roomId(), WsEnvelope.of("room.player_left",
                        new RoomPlayerLeftPayload(gone.playerId()))
                .withRoomId(gone.roomId()));

        if (!registry.snapshot(gone.roomId()).players().isEmpty()) {
            return;
        }
        // 마감 타이머는 즉시 끊는다. 남겨두면 빈 방에서 만료 → 자동 굴림 → 만료가 25초마다
        // 반복되고, 없는 사람 몫으로 점수가 기록된다.
        roundTimerService.cancelRoom(gone.roomId());
        // 진행 상태는 아직 버리지 않는다 — 새로고침은 "끊고 다시 연결"이라 여기서 버리면
        // 돌아온 사람이 자기 게임을 잃는다. 유예 뒤에도 비어 있으면 그때 닫는다.
        roomCloseScheduler.schedule(
                gone.roomId(),
                emptyRoomGrace(gone.roomId()),
                () -> closeRoomIfStillEmpty(gone.roomId())
        );
    }

    /**
     * 이 방을 닫기까지 줄 유예. 기준은 phase가 아니라 <b>"잃을 것이 있는지"</b>다.
     * <p>
     * registry의 phase는 마지막 참가자가 빠지는 순간 함께 버려지므로({@code RoomSessionRegistry.remove})
     * 이 시점엔 신뢰할 수 없다. 라운드 상태가 남아 있다 = 진행 중인 게임이 있다는 뜻이고,
     * 그게 곧 서둘러 닫으면 안 되는 이유다.
     */
    private Duration emptyRoomGrace(String roomId) {
        return roundSynchronizationService.findByRoomId(roomId).isPresent()
                ? ACTIVE_GAME_GRACE
                : EMPTY_LOBBY_GRACE;
    }

    /**
     * Redis에 이 방이 남아 있는지. phase가 없으면 방 해시 자체가 사라진 것이다
     * ({@code RoomValidationService.getSnapshot}이 그때 {@code RoomSnapshot.notFound}를 준다) —
     * REST 경로도 같은 기준으로 404를 낸다.
     */
    private boolean roomIsGone(String roomId) {
        com.ssafy.yorr.room.dto.RoomSnapshot room = roomService.getSnapshot(roomId);
        return room == null || room.phase() == null;
    }

    /**
     * 유예가 끝났다. 여전히 아무도 없으면 방을 완전히 닫는다.
     * <p>
     * 예약 시점과 실행 시점 사이에 누군가 돌아올 수 있어 여기서 한 번 더 확인한다
     * (예약 취소와 이 검사는 서로를 보완한다 — 취소가 늦게 도착해도 방이 죽지 않는다).
     */
    private void closeRoomIfStillEmpty(String roomId) {
        if (!registry.snapshot(roomId).players().isEmpty()) {
            return;
        }
        roundTimerService.cancelRoom(roomId);
        roundSynchronizationService.remove(roomId);
        roomService.close(roomId);
        log.info("빈 방을 닫았습니다: room={}", roomId);
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
        heartbeatMonitor.recordPing(session);
        // ping의 clientTs는 클라가 RTT/시계오프셋 계산에 씀 → 서버는 안 봐도 OK
        WsEnvelope<SysPongPayload> pong =
                WsEnvelope.of("sys.pong", new SysPongPayload(System.currentTimeMillis()));
        send(session, pong);
    }

    private void disconnectIdleSession(WebSocketSession session) {
        try {
            send(session, WsEnvelope.of(
                    "sys.disconnect",
                    new SysDisconnectPayload(DisconnectReason.IDLE_TIMEOUT)
            ));
        } catch (IOException e) {
            log.debug("heartbeat timeout 통지 실패: {}", session.getId(), e);
        } finally {
            try {
                session.close(CloseStatus.POLICY_VIOLATION);
            } catch (IOException e) {
                log.debug("heartbeat timeout 세션 종료 실패: {}", session.getId(), e);
            }
        }
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
            // 점수 방송·라운드 종료·다음 턴 시작·게임 종료 판단은 전부 advanceTurn 한 곳에 있다.
            // 마감 만료 경로(RoundTimerService)와 같은 코드를 지나야 두 경로가 어긋나지 않는다.
            roundTimerService.advanceTurn(roomId, result, in.msgId());
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
            broadcaster.broadcast(
                    roomId,
                    WsEnvelope.of(
                                    "dice.broadcast",
                                    new DiceBroadcastPayload(
                                            member.playerId(),
                                            state.roundNumber(),
                                            state.activeRollCount(),
                                            state.activeDice(),
                                            payload.held(),
                                            false
                                    )
                            )
                            .withRoomId(roomId)
                            .withMsgId(in.msgId())
            );
            roundTimerService.start(roomId, state);
        } catch (RoundSynchronizationException exception) {
            sendError(session, toWsErrorCode(exception.reason()), exception.getMessage(), in.msgId());
        } catch (IllegalArgumentException exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, exception.getMessage(), in.msgId());
        }
    }

    /**
     * dice.hold → dice.hold_changed. 굴림 사이에 바뀐 KEEP을 방 전원에게 알린다.
     * <p>
     * 타이머는 다시 걸지 않는다. KEEP 토글로 마감이 계속 미뤄지면 턴이 끝나지 않는다 —
     * 시간을 늘려주는 행동은 굴림과 제출뿐이다.
     */
    private void handleDiceHold(WebSocketSession session, InboundEnvelope in) throws IOException {
        String roomId = in.roomId();
        RoomSessionRegistry.Member member = registry.of(session);
        if (roomId == null || roomId.isBlank() || member == null || !roomId.equals(member.roomId())) {
            sendError(session, WsErrorCode.NOT_IN_ROOM, "방에 입장한 뒤에만 KEEP을 바꿀 수 있습니다.", in.msgId());
            return;
        }

        DiceHoldPayload payload;
        try {
            payload = objectMapper.treeToValue(in.payload(), DiceHoldPayload.class);
        } catch (Exception exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "dice.hold payload가 올바르지 않습니다.", in.msgId());
            return;
        }

        try {
            var state = roundSynchronizationService.recordHold(roomId, member.playerId(), payload);
            broadcaster.broadcast(
                    roomId,
                    WsEnvelope.of(
                                    "dice.hold_changed",
                                    new DiceHoldChangedPayload(
                                            member.playerId(),
                                            state.roundNumber(),
                                            state.activeHeld()
                                    )
                            )
                            .withRoomId(roomId)
                            .withMsgId(in.msgId())
            );
        } catch (RoundSynchronizationException exception) {
            sendError(session, toWsErrorCode(exception.reason()), exception.getMessage(), in.msgId());
        } catch (IllegalArgumentException exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, exception.getMessage(), in.msgId());
        }
    }

    private static WsErrorCode toWsErrorCode(RoundSynchronizationException.Reason reason) {
        return switch (reason) {
            case PLAYER_NOT_IN_ROUND -> WsErrorCode.NOT_IN_ROOM;
            // 남의 턴에 굴리거나 기록하려 한 경우 · 이미 제출을 끝낸 턴을 또 건드린 경우.
            // 클라이언트가 "지금은 내 차례가 아니다"로 구분해 안내할 수 있게 전용 코드를 준다.
            case NOT_ACTIVE_PLAYER,
                 ALREADY_SUBMITTED -> WsErrorCode.NOT_YOUR_TURN;
            case INVALID_ROUND,
                 INVALID_PLAYER,
                 INVALID_DICE,
                 INVALID_ROLL,
                 INVALID_CATEGORY,
                 ROUND_ALREADY_INITIALIZED,
                 ROUND_MISMATCH,
                 // 종료 후 지연 요청. 클라 화면이 아직 결과로 넘어가지 않은 정상 상황이라 INTERNAL이 아니다.
                 GAME_ALREADY_FINISHED -> WsErrorCode.INVALID_MESSAGE;
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
