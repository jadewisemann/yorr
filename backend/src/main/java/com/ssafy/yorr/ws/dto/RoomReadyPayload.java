package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** C→S: 대기방 준비 토글. (SSOT: RoomReadyPayload) */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RoomReadyPayload(boolean ready) {
}
