package com.ssafy.yorr.game.dto;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public record ScoreCandidatesResponse(Map<String, Integer> candidates) {

    public ScoreCandidatesResponse {
        if (candidates == null) {
            throw new IllegalArgumentException("점수 후보는 null일 수 없습니다.");
        }
        candidates = Collections.unmodifiableMap(new LinkedHashMap<>(candidates));
    }
}
