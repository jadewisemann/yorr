package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * 리액션 종류. reaction.send(수신)·reaction.broadcast(송신) 양쪽에 쓰인다. (SSOT: ReactionType)
 * 프론트 이모지 셋과 협의된 유니온 → 오타를 역직렬화 단계에서 차단.
 */
public enum ReactionType {
    LIKE("like"),
    LAUGH("laugh"),
    SHOCK("shock"),
    CLAP("clap"),
    GG("gg");

    private final String wire;

    ReactionType(String wire) {
        this.wire = wire;
    }

    @JsonValue
    public String wire() {
        return wire;
    }

    @JsonCreator
    public static ReactionType from(String value) {
        for (ReactionType r : values()) {
            if (r.wire.equals(value)) {
                return r;
            }
        }
        throw new IllegalArgumentException("알 수 없는 ReactionType: " + value);
    }
}
