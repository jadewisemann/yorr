package com.ssafy.yorr.ws.dto;

/**
 * S→C (JOINED): 내 입장 확정 + 발급 세션 + 전체 스냅샷. 본인에게만 보낸다. (SSOT: RoomJoinedPayload)
 *  - you          : 서버가 발급한 내 playerId.
 *  - sessionToken : 재접속 때 다시 제시할 토큰. 클라가 저장.
 */
public record RoomJoinedPayload(
        String you,
        String sessionToken,
        RoomSnapshot snapshot
) {
}
