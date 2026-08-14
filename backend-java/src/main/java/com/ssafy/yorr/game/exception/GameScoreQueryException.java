package com.ssafy.yorr.game.exception;

public class GameScoreQueryException extends RuntimeException {

    private final Reason reason;

    public GameScoreQueryException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public GameScoreQueryException(Reason reason, String message, Throwable cause) {
        super(message, cause);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }

    public enum Reason {
        ROOM_NOT_FOUND,
        GAME_NOT_STARTED,
        PLAYER_NOT_IN_ROOM,
        GAME_NOT_FINISHED,
        STORE_FAILURE
    }
}
