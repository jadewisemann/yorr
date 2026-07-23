package com.ssafy.yorr.ws.dto;

import java.util.List;

/**
 * 방 전체 스냅샷. room.joined / state.sync / sys.reconnected 가 이걸 싣는다. (SSOT: RoomSnapshot)
 *
 * ⚠️ SSOT 의 optional 필드 `game?: GameState` 는 STUB(게임 도메인 소유)이므로 이 브랜치에서는 생략한다.
 *    게임 도메인 owner(고용훈/유상은)가 GameState 를 미러링할 때 여기에 nullable 필드로 추가하면 된다.
 *    (WsEnvelope 가 null 을 드롭하듯, 추가 시에도 미진행 상태면 JSON 에서 빠지게 @JsonInclude 고려.)
 */
public record RoomSnapshot(
        String roomId,
        RoomPhase phase,
        String hostId,
        List<Player> players
) {
    public RoomSnapshot {
        // 방어적 복사 + null 안전(계약상 players 는 항상 배열).
        players = players == null ? List.of() : List.copyOf(players);
    }
}
