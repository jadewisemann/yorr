package com.ssafy.yorr.ws.dto;

/** S→C: 방 종료. (SSOT: RoomClosedPayload) */
public record RoomClosedPayload(RoomCloseReason reason) {
}
