package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * C→S: 방 퇴장. 빈 payload(대상 방은 envelope.roomId). (SSOT: RoomLeavePayload = Record<string, never>)
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RoomLeavePayload() {
}
