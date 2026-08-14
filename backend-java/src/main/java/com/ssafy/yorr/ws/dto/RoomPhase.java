package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** 방 진행 단계. RoomSnapshot.phase 에 실린다. (SSOT: RoomPhase) */
public enum RoomPhase {
    WAITING("waiting"),
    PLAYING("playing"),
    FINISHED("finished");

    private final String wire;

    RoomPhase(String wire) {
        this.wire = wire;
    }

    @JsonValue
    public String wire() {
        return wire;
    }

    @JsonCreator
    public static RoomPhase from(String value) {
        for (RoomPhase p : values()) {
            if (p.wire.equals(value)) {
                return p;
            }
        }
        throw new IllegalArgumentException("알 수 없는 RoomPhase: " + value);
    }
}
