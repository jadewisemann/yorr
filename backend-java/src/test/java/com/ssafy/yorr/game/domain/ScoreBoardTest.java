package com.ssafy.yorr.game.domain;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScoreBoardTest {

    @Test
    void distinguishesUnfilledCategoryFromConfirmedZero() {
        ScoreBoard scoreboard = new ScoreBoard(Map.of("ones", 0), 0, 0, 0);

        assertThat(scoreboard.categories()).hasSize(12);
        assertThat(scoreboard.categories()).containsEntry("ones", 0);
        assertThat(scoreboard.categories().get("twos")).isNull();
    }

    @Test
    void copiesCategoriesDefensivelyAndReturnsUnmodifiableMap() {
        Map<String, Integer> categories = new HashMap<>();
        categories.put("choice", 15);

        ScoreBoard scoreboard = new ScoreBoard(categories, 0, 0, 15);
        categories.put("choice", 30);

        assertThat(scoreboard.categories()).containsEntry("choice", 15);
        assertThatThrownBy(() -> scoreboard.categories().put("yacht", 50))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void rejectsNegativeScores() {
        assertThatThrownBy(() -> new ScoreBoard(Map.of("ones", -1), 0, 0, 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ScoreBoard(Map.of(), 0, 0, -1))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
