package com.ssafy.yorr.ws.dto;

/** S→C: 준비 상태 변경(브로드캐스트). (SSOT: RoomReadyChangedPayload) */
public record RoomReadyChangedPayload(
        String playerId,
        boolean ready
) {
}
