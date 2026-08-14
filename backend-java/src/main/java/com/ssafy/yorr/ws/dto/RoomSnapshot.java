package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * 방 전체 스냅샷. room.joined / state.sync / sys.reconnected 가 이걸 싣는다. (SSOT: RoomSnapshot)
 *
 * game은 진행 중 재접속에서만 채우고, 대기실에서는 JSON에서 생략한다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record RoomSnapshot(
        String roomId,
        String gameCode,
        RoomPhase phase,
        String hostId,
        List<Player> players,
        Object game,
        Integer capacity
) {
    public RoomSnapshot(
            String roomId,
            String gameCode,
            RoomPhase phase,
            String hostId,
            List<Player> players,
            Object game
    ) {
        this(roomId, gameCode, phase, hostId, players, game, null);
    }

    public RoomSnapshot(String roomId, RoomPhase phase, String hostId, List<Player> players) {
        this(roomId, null, phase, hostId, players, null, null);
    }

    public RoomSnapshot(String roomId, RoomPhase phase, String hostId, List<Player> players, Object game) {
        this(roomId, null, phase, hostId, players, game, null);
    }

    public RoomSnapshot {
        // 방어적 복사 + null 안전(계약상 players 는 항상 배열).
        players = players == null ? List.of() : List.copyOf(players);
    }
}
