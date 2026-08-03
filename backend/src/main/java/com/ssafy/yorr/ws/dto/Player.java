package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.ssafy.yorr.room.dto.BotDifficulty;
import com.ssafy.yorr.room.dto.ParticipantKind;

/**
 * 방 참가자 1명. RoomSnapshot.players·room.player_joined 에 실린다. (SSOT: Player)
 * playerId 는 서버가 발급하는 식별자(SSOT: PlayerId = string).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Player(
        String playerId,
        String nickname,
        PlayerStatus status,
        boolean isHost,
        ParticipantKind kind,
        BotDifficulty difficulty
) {
    public Player(String playerId, String nickname, PlayerStatus status, boolean isHost) {
        this(playerId, nickname, status, isHost, ParticipantKind.HUMAN, null);
    }
}
