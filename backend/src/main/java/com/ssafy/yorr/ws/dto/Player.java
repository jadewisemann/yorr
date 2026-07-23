package com.ssafy.yorr.ws.dto;

/**
 * 방 참가자 1명. RoomSnapshot.players·room.player_joined 에 실린다. (SSOT: Player)
 * playerId 는 서버가 발급하는 식별자(SSOT: PlayerId = string).
 */
public record Player(
        String playerId,
        String nickname,
        PlayerStatus status,
        boolean isHost
) {
}
