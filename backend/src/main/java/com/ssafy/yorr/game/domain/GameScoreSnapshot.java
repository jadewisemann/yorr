package com.ssafy.yorr.game.domain;

import com.ssafy.yorr.room.dto.RoomPhase;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public record GameScoreSnapshot(
        String roomId,
        String gameId,
        RoomPhase phase,
        Map<String, ScoreBoard> scoreboards
) {

    public GameScoreSnapshot {
        if (roomId == null || roomId.isBlank()) {
            throw new IllegalArgumentException("roomId must not be blank");
        }
        if (gameId == null || gameId.isBlank()) {
            throw new IllegalArgumentException("gameId must not be blank");
        }
        if (phase == null) {
            throw new IllegalArgumentException("phase must not be null");
        }
        if (scoreboards == null || scoreboards.isEmpty()) {
            throw new IllegalArgumentException("scoreboards must not be empty");
        }
        scoreboards = Collections.unmodifiableMap(new LinkedHashMap<>(scoreboards));
    }
}
