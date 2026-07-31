package com.ssafy.yorr.room.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record RoomPlayerSnapshot(
        String playerId,
        String nickname,
        int score,
        ParticipantKind kind
) {
    public RoomPlayerSnapshot(String playerId, String nickname, int score) {
        this(playerId, nickname, score, ParticipantKind.HUMAN);
    }
}
