package com.ssafy.yorr.game.module;

import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomValidationService;
import org.springframework.stereotype.Service;

@Service
public class GameLifecycleService {

    private final RoomValidationService rooms;
    private final GameModuleRegistry modules;

    public GameLifecycleService(RoomValidationService rooms, GameModuleRegistry modules) {
        this.rooms = rooms;
        this.modules = modules;
    }

    public GameStartResponse start(String roomCode) {
        GameStartResponse game = rooms.startGame(roomCode);
        try {
            GameModule module = modules.require(game.snapshot().gameCode());
            module.start(roomCode, game);
            return game;
        } catch (RuntimeException exception) {
            rooms.rollbackStart(roomCode, game.gameId());
            throw exception;
        }
    }

    public boolean returnToLobby(String roomCode, RoomSnapshot room) {
        if (!rooms.returnToLobby(roomCode)) return false;
        modules.require(room.gameCode()).reset(roomCode);
        return true;
    }

    public void removePlayer(String roomCode, String gameCode, String playerId) {
        modules.require(gameCode).removePlayer(roomCode, playerId);
    }
}
