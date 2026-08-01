package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.module.GameModule;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.round.application.GameReconnectSnapshotService;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.application.RoundTimerService;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionResult;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionService;
import com.ssafy.yorr.game.round.domain.RoundSynchronizationException;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.DiceBroadcastPayload;
import com.ssafy.yorr.ws.dto.DiceHoldChangedPayload;
import com.ssafy.yorr.ws.dto.DiceHoldPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import com.ssafy.yorr.ws.dto.DiceShakePayload;
import com.ssafy.yorr.ws.dto.DiceShakenPayload;
import com.ssafy.yorr.ws.dto.DiceThrowPayload;
import com.ssafy.yorr.ws.dto.DiceThrownPayload;
import com.ssafy.yorr.ws.dto.ErrorPayload;
import com.ssafy.yorr.ws.dto.InboundEnvelope;
import com.ssafy.yorr.ws.dto.RoomPhase;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.StateSyncPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import com.ssafy.yorr.ws.dto.WsErrorCode;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.Comparator;
import java.util.Set;

@Component
public class YachtDiceGameModule implements GameModule {

    public static final String CODE = "YACHT_DICE";

    private final RoundSynchronizationService rounds;
    private final RoundTimerService timers;
    private final RoomSessionRegistry sessions;
    private final RoomBroadcaster broadcaster;
    private final ScoreRoundSubmissionService submissions;
    private final GameReconnectSnapshotService reconnectSnapshots;
    private final ObjectMapper objectMapper;

    public YachtDiceGameModule(
            RoundSynchronizationService rounds,
            RoundTimerService timers,
            RoomSessionRegistry sessions,
            RoomBroadcaster broadcaster,
            ScoreRoundSubmissionService submissions,
            GameReconnectSnapshotService reconnectSnapshots,
            ObjectMapper objectMapper
    ) {
        this.rounds = rounds;
        this.timers = timers;
        this.sessions = sessions;
        this.broadcaster = broadcaster;
        this.submissions = submissions;
        this.reconnectSnapshots = reconnectSnapshots;
        this.objectMapper = objectMapper;
    }

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public String name() {
        return "Yacht Dice";
    }

    @Override
    public void start(String roomCode, GameStartResponse game) {
        rounds.remove(roomCode);
        try {
            RoundState firstTurn = rounds.initialize(
                    roomCode,
                    1,
                    game.snapshot().players().stream()
                            .sorted(Comparator.comparing(
                                    player -> !player.playerId().equals(game.snapshot().hostId())
                            ))
                            .map(player -> player.playerId())
                            .toList()
            );
            sessions.markPhase(roomCode, RoomPhase.PLAYING);
            broadcastState(roomCode);
            timers.start(roomCode, firstTurn);
        } catch (RuntimeException exception) {
            reset(roomCode);
            throw exception;
        }
    }

    @Override
    public void reset(String roomCode) {
        timers.cancelRoom(roomCode);
        rounds.remove(roomCode);
        sessions.markPhase(roomCode, RoomPhase.WAITING);
        broadcastState(roomCode);
    }

    @Override
    public RoomSnapshot reconnect(String roomCode, String playerId) {
        RoomSnapshot snapshot = reconnectSnapshots.snapshot(roomCode, playerId);
        timers.clearOfflineMisses(roomCode, playerId);
        return snapshot;
    }

    @Override
    public void resume(String roomCode) {
        rounds.findByRoomId(roomCode)
                .filter(state -> !state.isFinished())
                .ifPresent(state -> timers.start(roomCode, state));
    }

    @Override
    public void pause(String roomCode) {
        timers.cancelRoom(roomCode);
    }

    @Override
    public void removePlayer(String roomCode, String playerId) {
        timers.removePlayer(roomCode, playerId);
    }

    @Override
    public void close(String roomCode) {
        timers.cancelRoom(roomCode);
        rounds.remove(roomCode);
    }

    @Override
    public boolean hasState(String roomCode) {
        return rounds.findByRoomId(roomCode).isPresent();
    }

    @Override
    public boolean handles(String messageType) {
        return Set.of("dice.roll", "dice.hold", "dice.shake", "dice.throw", "round.submit").contains(messageType);
    }

    @Override
    public void handle(WebSocketSession session, InboundEnvelope message) throws IOException {
        switch (message.type()) {
            case "dice.roll" -> roll(session, message);
            case "dice.hold" -> hold(session, message);
            case "dice.shake" -> shakeDice(session, message);
            case "dice.throw" -> throwDice(session, message);
            case "round.submit" -> submit(session, message);
            default -> throw new IllegalArgumentException("unsupported_game_message");
        }
    }

    private void roll(WebSocketSession session, InboundEnvelope message) throws IOException {
        RoomSessionRegistry.Member member = member(session, message);
        if (member == null) return;
        DiceRollPayload payload;
        try {
            payload = objectMapper.treeToValue(message.payload(), DiceRollPayload.class);
        } catch (Exception exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "invalid dice.roll payload", message.msgId());
            return;
        }
        try {
            RoundState state = rounds.recordRoll(message.roomId(), member.playerId(), payload);
            broadcaster.broadcast(message.roomId(), WsEnvelope.of("dice.broadcast", new DiceBroadcastPayload(
                    member.playerId(),
                    state.roundNumber(),
                    state.activeRollCount(),
                    state.activeDice(),
                    payload.held(),
                    false
            )).withRoomId(message.roomId()).withMsgId(message.msgId()));
            timers.start(message.roomId(), state);
        } catch (RoundSynchronizationException exception) {
            sendError(session, errorCode(exception.reason()), exception.getMessage(), message.msgId());
        } catch (IllegalArgumentException exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, exception.getMessage(), message.msgId());
        }
    }

    private void hold(WebSocketSession session, InboundEnvelope message) throws IOException {
        RoomSessionRegistry.Member member = member(session, message);
        if (member == null) return;
        DiceHoldPayload payload;
        try {
            payload = objectMapper.treeToValue(message.payload(), DiceHoldPayload.class);
        } catch (Exception exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "invalid dice.hold payload", message.msgId());
            return;
        }
        try {
            RoundState state = rounds.recordHold(message.roomId(), member.playerId(), payload);
            broadcaster.broadcast(message.roomId(), WsEnvelope.of(
                    "dice.hold_changed",
                    new DiceHoldChangedPayload(member.playerId(), state.roundNumber(), state.activeHeld())
            ).withRoomId(message.roomId()).withMsgId(message.msgId()));
        } catch (RoundSynchronizationException exception) {
            sendError(session, errorCode(exception.reason()), exception.getMessage(), message.msgId());
        } catch (IllegalArgumentException exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, exception.getMessage(), message.msgId());
        }
    }

    /**
     * dice.shake → dice.shaken 단순 릴레이. 턴 주인이 사발을 흔든 펄스를 방에 그대로 넘겨,
     * 관전 화면이 같은 손놀림으로 사발을 흔들게 한다. 라운드 상태는 건드리지 않는다.
     * <p>
     * 방향이 바뀔 때마다 올라와 다른 메시지보다 잦다. 그래서 턴 주인이 아닌 세션의 펄스는
     * 에러를 돌려주지 않고 조용히 버린다 — 턴이 넘어가는 찰나에 남은 펄스가 몇 개 올라오는 것은
     * 정상이고, 매번 에러를 돌려주면 그 순간 에러만 쏟아진다.
     */
    private void shakeDice(WebSocketSession session, InboundEnvelope message) throws IOException {
        RoomSessionRegistry.Member member = member(session, message);
        if (member == null) return;
        DiceShakePayload payload;
        try {
            payload = objectMapper.treeToValue(message.payload(), DiceShakePayload.class);
        } catch (Exception exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "invalid dice.shake payload", message.msgId());
            return;
        }
        boolean activePlayer = rounds.findByRoomId(message.roomId())
                .map(state -> member.playerId().equals(state.activePlayerId()))
                .orElse(false);
        if (!activePlayer) return;
        broadcaster.broadcast(message.roomId(), WsEnvelope.of(
                "dice.shaken",
                new DiceShakenPayload(member.playerId(), payload.roundNumber(),
                        payload.direction(), payload.strength())
        ).withRoomId(message.roomId()).withMsgId(message.msgId()));
    }

    /**
     * dice.throw → dice.thrown 단순 릴레이. 라운드 상태를 건드리지 않는다 — 주사위 눈은 dice.roll 에서
     * 이미 확정됐고, 이 메시지는 "지금 쏟아라"라는 연출 신호일 뿐이다. 그래서 유실돼도 게임 진행은
     * 어긋나지 않고, 관전 화면만 그 턴 동안 사발을 계속 흔들다가 다음 턴 전환에서 정리된다.
     */
    private void throwDice(WebSocketSession session, InboundEnvelope message) throws IOException {
        RoomSessionRegistry.Member member = member(session, message);
        if (member == null) return;
        DiceThrowPayload payload;
        try {
            payload = objectMapper.treeToValue(message.payload(), DiceThrowPayload.class);
        } catch (Exception exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "invalid dice.throw payload", message.msgId());
            return;
        }
        // 턴 주인이 아닌 세션의 신호는 버린다 — 남의 사발을 대신 쏟게 할 수 있다.
        boolean activePlayer = rounds.findByRoomId(message.roomId())
                .map(state -> member.playerId().equals(state.activePlayerId()))
                .orElse(false);
        if (!activePlayer) {
            sendError(session, WsErrorCode.NOT_YOUR_TURN, "only the active player can throw", message.msgId());
            return;
        }
        broadcaster.broadcast(message.roomId(), WsEnvelope.of(
                "dice.thrown",
                new DiceThrownPayload(member.playerId(), payload.roundNumber(), payload.rollCount())
        ).withRoomId(message.roomId()).withMsgId(message.msgId()));
    }

    private void submit(WebSocketSession session, InboundEnvelope message) throws IOException {
        RoomSessionRegistry.Member member = member(session, message);
        if (member == null) return;
        RoundSubmitPayload payload;
        try {
            payload = objectMapper.treeToValue(message.payload(), RoundSubmitPayload.class);
        } catch (Exception exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "invalid round.submit payload", message.msgId());
            return;
        }
        try {
            ScoreRoundSubmissionResult result = submissions.submit(message.roomId(), member.playerId(), payload);
            timers.advanceTurn(message.roomId(), result, message.msgId());
        } catch (ScoreConfirmationException exception) {
            sendError(session, errorCode(exception.reason()), exception.getMessage(), message.msgId());
        } catch (RoundSynchronizationException exception) {
            sendError(session, errorCode(exception.reason()), exception.getMessage(), message.msgId());
        } catch (IllegalArgumentException exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, exception.getMessage(), message.msgId());
        }
    }

    private RoomSessionRegistry.Member member(WebSocketSession session, InboundEnvelope message) throws IOException {
        RoomSessionRegistry.Member member = sessions.of(session);
        if (message.roomId() == null || message.roomId().isBlank()
                || member == null || !message.roomId().equals(member.roomId())) {
            sendError(session, WsErrorCode.NOT_IN_ROOM, "current room membership is required", message.msgId());
            return null;
        }
        return member;
    }

    private void sendError(WebSocketSession session, WsErrorCode code, String message, String refMsgId)
            throws IOException {
        String json = objectMapper.writeValueAsString(WsEnvelope.of(
                "error",
                new ErrorPayload(code, message, refMsgId, null)
        ));
        synchronized (session) {
            session.sendMessage(new TextMessage(json));
        }
    }

    private static WsErrorCode errorCode(RoundSynchronizationException.Reason reason) {
        return switch (reason) {
            case PLAYER_NOT_IN_ROUND -> WsErrorCode.NOT_IN_ROOM;
            case NOT_ACTIVE_PLAYER, ALREADY_SUBMITTED -> WsErrorCode.NOT_YOUR_TURN;
            case ROUND_NOT_INITIALIZED -> WsErrorCode.INTERNAL;
            default -> WsErrorCode.INVALID_MESSAGE;
        };
    }

    private static WsErrorCode errorCode(ScoreConfirmationException.Reason reason) {
        return switch (reason) {
            case GAME_NOT_FOUND -> WsErrorCode.ROOM_NOT_FOUND;
            case PLAYER_NOT_IN_GAME -> WsErrorCode.NOT_IN_ROOM;
            case STORE_FAILURE -> WsErrorCode.INTERNAL;
            default -> WsErrorCode.INVALID_MESSAGE;
        };
    }

    private void broadcastState(String roomCode) {
        broadcaster.broadcast(roomCode, WsEnvelope.of(
                "state.sync",
                new StateSyncPayload(sessions.snapshot(roomCode))
        ).withRoomId(roomCode));
    }
}
