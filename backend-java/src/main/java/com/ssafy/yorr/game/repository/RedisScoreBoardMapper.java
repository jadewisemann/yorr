package com.ssafy.yorr.game.repository;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;

import java.util.LinkedHashMap;
import java.util.Map;

final class RedisScoreBoardMapper {

    private static final String UPPER_SUBTOTAL_FIELD = "_upperSubtotal";
    private static final String UPPER_BONUS_FIELD = "_upperBonus";
    private static final String TOTAL_FIELD = "_total";

    private RedisScoreBoardMapper() {
    }

    static ScoreBoard fromHash(Map<Object, Object> stored) {
        LinkedHashMap<String, Integer> categories = new LinkedHashMap<>();
        for (ScoreCategory category : ScoreCategory.values()) {
            categories.put(category.apiKey(), integerValue(stored.get(category.apiKey()), null));
        }
        return new ScoreBoard(
                categories,
                integerValue(stored.get(UPPER_SUBTOTAL_FIELD), 0),
                integerValue(stored.get(UPPER_BONUS_FIELD), 0),
                integerValue(stored.get(TOTAL_FIELD), 0)
        );
    }

    private static Integer integerValue(Object value, Integer defaultValue) {
        if (value == null) {
            return defaultValue;
        }
        try {
            return Integer.valueOf(value.toString());
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException("Redis score value must be an integer: " + value, exception);
        }
    }
}
