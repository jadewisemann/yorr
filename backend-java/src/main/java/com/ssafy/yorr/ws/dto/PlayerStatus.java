package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * 플레이어 접속 상태. Player·presence.update 에 실린다. (SSOT: PlayerStatus)
 * 자바 상수는 대문자 관례라 계약 문자열(소문자)과 다르므로 wire 로 매핑한다.
 */
public enum PlayerStatus {
    ONLINE("online"),
    AWAY("away"),
    OFFLINE("offline");

    private final String wire;

    PlayerStatus(String wire) {
        this.wire = wire;
    }

    /** JSON 직렬화 값 = 계약 문자열. */
    @JsonValue
    public String wire() {
        return wire;
    }

    /** JSON 역직렬화: 계약 문자열 → enum. 모르는 값이면 예외. */
    @JsonCreator
    public static PlayerStatus from(String value) {
        for (PlayerStatus s : values()) {
            if (s.wire.equals(value)) {
                return s;
            }
        }
        throw new IllegalArgumentException("알 수 없는 PlayerStatus: " + value);
    }
}
