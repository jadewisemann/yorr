package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** 방이 종료된 사유. room.closed 에 실린다. (SSOT: RoomCloseReason) */
public enum RoomCloseReason {
    HOST_LEFT("host_left"),
    GAME_FINISHED("game_finished"),
    NOT_ENOUGH_PLAYERS("not_enough_players"),
    EMPTY("empty"),
    SERVER_SHUTDOWN("server_shutdown");

    private final String wire;

    RoomCloseReason(String wire) {
        this.wire = wire;
    }

    @JsonValue
    public String wire() {
        return wire;
    }

    @JsonCreator
    public static RoomCloseReason from(String value) {
        for (RoomCloseReason r : values()) {
            if (r.wire.equals(value)) {
                return r;
            }
        }
        throw new IllegalArgumentException("알 수 없는 RoomCloseReason: " + value);
    }
}
