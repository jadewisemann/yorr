package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.domain.RoundState;

public record RoundStartedEvent(String roomId, RoundState state) {

    public RoundStartedEvent {
        if (roomId == null || roomId.isBlank()) {
            throw new IllegalArgumentException("roomId must not be blank");
        }
        if (state == null) {
            throw new IllegalArgumentException("state must not be null");
        }
    }
}
