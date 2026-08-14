package com.ssafy.yorr.ws.dto;

/** S→C: 다른 사람 입장(브로드캐스트). (SSOT: RoomPlayerJoinedPayload) */
public record RoomPlayerJoinedPayload(Player player) {
}
