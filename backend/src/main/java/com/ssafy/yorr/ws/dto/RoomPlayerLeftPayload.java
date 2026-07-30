package com.ssafy.yorr.ws.dto;

/** S→C: 다른 사람 퇴장(브로드캐스트). (SSOT: RoomPlayerLeftPayload) */
public record RoomPlayerLeftPayload(String playerId) {
}
