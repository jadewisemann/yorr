package com.ssafy.yorr.ws.dto;

/** S→C: 접속/이탈 등 presence 변경(브로드캐스트). (SSOT: PresenceUpdatePayload) */
public record PresenceUpdatePayload(
        String playerId,
        PlayerStatus status
) {
}
