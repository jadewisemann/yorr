package com.ssafy.yorr.ws.dto;

/**
 * S→C: 소켓 오픈 직후 서버 인사. 인증(room.join) 전에 먼저 온다. (SSOT: SysConnectedPayload)
 * heartbeatIntervalMs = 클라가 sys.ping 을 보낼 주기.
 */
public record SysConnectedPayload(
        long serverTs,
        int protocolVersion,
        int heartbeatIntervalMs
) {
}
