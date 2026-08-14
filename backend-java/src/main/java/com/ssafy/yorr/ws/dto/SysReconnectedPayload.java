package com.ssafy.yorr.ws.dto;

/** S→C: 재접속 승인 + 전체 상태 재동기화. (SSOT: SysReconnectedPayload) */
public record SysReconnectedPayload(RoomSnapshot snapshot) {
}
