package com.ssafy.yorr.ws.dto;

/** S→C: 서버가 연결을 끊기 직전 사유 통지. (SSOT: SysDisconnectPayload) */
public record SysDisconnectPayload(DisconnectReason reason) {
}
