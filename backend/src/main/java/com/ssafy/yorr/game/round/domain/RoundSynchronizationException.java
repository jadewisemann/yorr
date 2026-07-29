package com.ssafy.yorr.game.round.domain;

public class RoundSynchronizationException extends RuntimeException {

    private final Reason reason;

    public RoundSynchronizationException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }

    public enum Reason {
        INVALID_ROUND,
        INVALID_PLAYER,
        INVALID_DICE,
        INVALID_ROLL,
        INVALID_CATEGORY,
        ROUND_NOT_INITIALIZED,
        ROUND_ALREADY_INITIALIZED,
        ROUND_MISMATCH,
        PLAYER_NOT_IN_ROUND,
        NOT_ACTIVE_PLAYER,
        ALREADY_SUBMITTED,
        /** 마지막 라운드까지 끝난 게임에 굴림·제출이 들어왔다. 종료 후 지연 요청의 1차 방어선. */
        GAME_ALREADY_FINISHED
    }
}
