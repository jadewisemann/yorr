package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** 서버가 연결을 끊기 직전 통지하는 사유. sys.disconnect 에 실린다. (SSOT: DisconnectReason) */
public enum DisconnectReason {
    SERVER_SHUTDOWN("server_shutdown"),
    KICKED("kicked"),
    IDLE_TIMEOUT("idle_timeout"),
    REPLACED_BY_NEW_SESSION("replaced_by_new_session"),
    PROTOCOL_ERROR("protocol_error");

    private final String wire;

    DisconnectReason(String wire) {
        this.wire = wire;
    }

    @JsonValue
    public String wire() {
        return wire;
    }

    @JsonCreator
    public static DisconnectReason from(String value) {
        for (DisconnectReason r : values()) {
            if (r.wire.equals(value)) {
                return r;
            }
        }
        throw new IllegalArgumentException("알 수 없는 DisconnectReason: " + value);
    }
}
