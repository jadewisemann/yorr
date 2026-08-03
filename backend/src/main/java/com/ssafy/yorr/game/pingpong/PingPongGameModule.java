package com.ssafy.yorr.game.pingpong;

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

@Component
public class PingPongGameModule implements GameModule {

    public static final String CODE = "PING_PONG";

    private final PingPongGameService games;
    private final RoomSessionRegistry sessions;
    private final ObjectMapper objectMapper;

    public PingPongGameModule(
            PingPongGameService games,
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
        return "Ping Pong";
    }

    @Override
    public int minPlayers() {
        return 2;
    }

    @Override
    public int maxPlayers() {
        return 2;
    }

    @Override
    public boolean supportsBots() {
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
        return games.reconnect(roomCode);
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
        return "pingpong.swing".equals(messageType);
    }

    @Override
    public void handle(WebSocketSession session, InboundEnvelope message) throws IOException {
        RoomSessionRegistry.Member member = sessions.of(session);
        if (member == null || message.roomId() == null || !message.roomId().equals(member.roomId())) {
            sendError(session, WsErrorCode.NOT_IN_ROOM, "current room membership is required", message.msgId());
            return;
        }
        try {
            PingPongSwingPayload payload = objectMapper.treeToValue(message.payload(), PingPongSwingPayload.class);
            games.swing(message.roomId(), member.playerId(), payload);
        } catch (IllegalArgumentException exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, exception.getMessage(), message.msgId());
        } catch (Exception exception) {
            sendError(session, WsErrorCode.INVALID_MESSAGE, "invalid pingpong.swing payload", message.msgId());
        }
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
