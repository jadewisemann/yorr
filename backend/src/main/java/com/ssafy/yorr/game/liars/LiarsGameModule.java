package com.ssafy.yorr.game.liars;

import com.ssafy.yorr.game.module.GameModule;
import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.ErrorPayload;
import com.ssafy.yorr.ws.dto.InboundEnvelope;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import com.ssafy.yorr.ws.dto.WsErrorCode;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;

/**
 * 라이어스 다이스 모듈. 이 클래스가 빈으로 뜨는 것만으로 {@code GameModuleRegistry}에 등록되고
 * {@code game.liars.*} 메시지가 여기로 들어온다.
 */
@Component
public class LiarsGameModule implements GameModule {

    public static final String CODE = "LIARS";

    private final LiarsGameService games;
    private final RoomSessionRegistry sessions;
    private final ObjectMapper objectMapper;

    public LiarsGameModule(
            LiarsGameService games,
            RoomSessionRegistry sessions,
            ObjectMapper objectMapper
    ) {
        this.games = games;
        this.sessions = sessions;
        this.objectMapper = objectMapper;
    }

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public String name() {
        return "Liar's Dice";
    }

    @Override
    public int minPlayers() {
        return 2;
    }

    @Override
    public int maxPlayers() {
        return 6;
    }

    @Override
    public boolean supportsBots() {
        // 봇이 허풍을 떨어야 하는 게임이라 "가만히 있는 봇"으로는 판이 성립하지 않는다.
        return false;
    }

    @Override
    public void start(String roomCode, GameStartResponse game) {
        games.start(roomCode, game);
    }

    @Override
    public void reset(String roomCode) {
        games.reset(roomCode);
    }

    @Override
    public RoomSnapshot reconnect(String roomCode, String playerId) {
        return games.reconnect(roomCode, playerId);
    }

    @Override
    public void resume(String roomCode) {
        games.resume(roomCode);
    }

    @Override
    public void pause(String roomCode) {
        games.pause(roomCode);
    }

    @Override
    public void removePlayer(String roomCode, String playerId) {
        games.removePlayer(roomCode, playerId);
    }

    @Override
    public void close(String roomCode) {
        games.close(roomCode);
    }

    @Override
    public boolean hasState(String roomCode) {
        return games.hasState(roomCode);
    }

    @Override
    public boolean handles(String messageType) {
        return "bid".equals(messageType) || "challenge".equals(messageType);
    }

    @Override
    public void handle(WebSocketSession session, InboundEnvelope message) throws IOException {
        RoomSessionRegistry.Member member = sessions.of(session);
        if (member == null || message.roomId() == null || !message.roomId().equals(member.roomId())) {
            sendError(session, WsErrorCode.NOT_IN_ROOM, "current room membership is required", message.msgId());
            return;
        }
        try {
            if ("challenge".equals(message.type())) {
                games.challenge(message.roomId(), member.playerId());
                return;
            }
            LiarsBidPayload payload = objectMapper.treeToValue(message.payload(), LiarsBidPayload.class);
            games.bid(message.roomId(), member.playerId(), payload);
        } catch (IllegalArgumentException exception) {
            // 되돌릴 조작을 화면이 알아야 한다 — 내 차례가 아닌 것과 선언이 낮은 것은 다른 안내다.
            sendError(session, errorCode(exception.getMessage()), exception.getMessage(), message.msgId());
        } catch (Exception exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "invalid liars message", message.msgId());
        }
    }

    private static WsErrorCode errorCode(String reason) {
        return "not_your_turn".equals(reason) ? WsErrorCode.NOT_YOUR_TURN : WsErrorCode.INVALID_MESSAGE;
    }

    private void sendError(WebSocketSession session, WsErrorCode code, String message, String refMsgId)
            throws IOException {
        String json = objectMapper.writeValueAsString(WsEnvelope.of(
                "error", new ErrorPayload(code, message, refMsgId, null)
        ));
        synchronized (session) {
            session.sendMessage(new TextMessage(json));
        }
    }
}
