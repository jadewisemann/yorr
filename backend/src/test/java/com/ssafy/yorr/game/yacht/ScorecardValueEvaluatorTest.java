package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import org.junit.jupiter.api.Test;

import java.util.EnumMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ScorecardValueEvaluatorTest {

    private final ScorecardValueEvaluator evaluator = new ScorecardValueEvaluator();

    @Test
    void valuesSecuringTheUpperBonusMoreThanAHighImmediateCategory() {
        ScoreBoard board = boardWithUpperSubtotal(
                33,
                Map.of(
                        ScoreCategory.ACES, 3,
                        ScoreCategory.DEUCES, 6,
                        ScoreCategory.THREES, 9,
                        ScoreCategory.FOURS, 0,
                        ScoreCategory.FIVES, 15
                )
        );

        double sixes = evaluator.categoryUtility(board, ScoreCategory.SIXES, 30);
        double yacht = evaluator.categoryUtility(board, ScoreCategory.YACHT, 50);

        assertThat(sixes).isGreaterThan(yacht);
    }

    @Test
    void sacrificesAClosedOpportunityBeforeTheLastUpperBonusChance() {
        ScoreBoard board = boardWithUpperSubtotal(
                60,
                Map.of(
                        ScoreCategory.ACES, 3,
                        ScoreCategory.DEUCES, 6,
                        ScoreCategory.THREES, 9,
                        ScoreCategory.FOURS, 12,
                        ScoreCategory.FIVES, 30
                )
        );

        double zeroYacht = evaluator.categoryUtility(board, ScoreCategory.YACHT, 0);
        double zeroSixes = evaluator.categoryUtility(board, ScoreCategory.SIXES, 0);

        assertThat(zeroYacht).isGreaterThan(zeroSixes);
    }

    private static ScoreBoard boardWithUpperSubtotal(
            int upperSubtotal,
            Map<ScoreCategory, Integer> filled
    ) {
        EnumMap<ScoreCategory, Integer> scores = new EnumMap<>(ScoreCategory.class);
        scores.putAll(filled);
        Map<String, Integer> categories = new java.util.HashMap<>();
        scores.forEach((category, score) -> categories.put(category.apiKey(), score));
        return new ScoreBoard(categories, upperSubtotal, 0, upperSubtotal);
    }
}
