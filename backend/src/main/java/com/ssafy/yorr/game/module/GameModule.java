package com.ssafy.yorr.game.module;

import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.ws.dto.InboundEnvelope;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;

public interface GameModule {

    String code();

    String name();

    default int minPlayers() {
        return 1;
    }

    default int maxPlayers() {
        return 6;
    }

    default boolean supportsBots() {
        return true;
    }

    void start(String roomCode, GameStartResponse game);

    void reset(String roomCode);

    RoomSnapshot reconnect(String roomCode, String playerId);

    void resume(String roomCode);

    void pause(String roomCode);

    void removePlayer(String roomCode, String playerId);

    void close(String roomCode);

    boolean hasState(String roomCode);

    boolean handles(String messageType);

    void handle(WebSocketSession session, InboundEnvelope message) throws IOException;
}
