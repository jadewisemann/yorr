package com.ssafy.yorr.game.exception;

public class ScoreConfirmationException extends RuntimeException {

    private final Reason reason;

    public ScoreConfirmationException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public ScoreConfirmationException(Reason reason, String message, Throwable cause) {
        super(message, cause);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }

    public enum Reason {
        INVALID_CATEGORY,
        INVALID_DICE,
        GAME_NOT_FOUND,
        GAME_NOT_ACTIVE,
        PLAYER_NOT_IN_GAME,
        ROUND_ALREADY_SCORED,
        CATEGORY_ALREADY_USED,
        STORE_FAILURE
    }
}
