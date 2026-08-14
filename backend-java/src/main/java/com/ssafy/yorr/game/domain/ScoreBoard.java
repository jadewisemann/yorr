package com.ssafy.yorr.game.domain;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public record ScoreBoard(
        Map<String, Integer> categories,
        int upperSubtotal,
        int upperBonus,
        int total
) {

    public ScoreBoard {
        if (categories == null) {
            throw new IllegalArgumentException("카테고리별 점수는 null일 수 없습니다.");
        }
        if (upperSubtotal < 0 || upperBonus < 0 || total < 0) {
            throw new IllegalArgumentException("점수 합계는 0 이상이어야 합니다.");
        }

        LinkedHashMap<String, Integer> normalized = new LinkedHashMap<>();
        for (ScoreCategory category : ScoreCategory.values()) {
            Integer score = categories.get(category.apiKey());
            if (score != null && score < 0) {
                throw new IllegalArgumentException("카테고리 점수는 0 이상이어야 합니다.");
            }
            normalized.put(category.apiKey(), score);
        }
        categories = Collections.unmodifiableMap(normalized);
    }
}
