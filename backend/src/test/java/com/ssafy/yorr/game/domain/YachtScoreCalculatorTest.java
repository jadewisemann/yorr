package com.ssafy.yorr.game.domain;

import org.junit.jupiter.api.Test;

import java.util.EnumMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class YachtScoreCalculatorTest {

    @Test
    void calculatesEveryUpperCategoryScore() {
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.ACES, new int[]{1, 1, 1, 2, 3}))
                .isEqualTo(3);
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.DEUCES, new int[]{2, 2, 2, 1, 3}))
                .isEqualTo(6);
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.THREES, new int[]{3, 3, 3, 1, 2}))
                .isEqualTo(9);
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.FOURS, new int[]{4, 4, 4, 1, 2}))
                .isEqualTo(12);
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.FIVES, new int[]{5, 5, 5, 1, 2}))
                .isEqualTo(15);
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.SIXES, new int[]{6, 6, 6, 1, 2}))
                .isEqualTo(18);
    }

    @Test
    void scoresZeroWhenUpperCategoryFaceIsMissing() {
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.ACES, new int[]{2, 3, 4, 5, 6})).isZero();
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.SIXES, new int[]{1, 2, 3, 4, 5})).isZero();
    }

    @Test
    void calculatesChoiceAsSumOfAllDice() {
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.CHOICE, new int[]{1, 2, 3, 4, 5}))
                .isEqualTo(15);
    }

    @Test
    void calculatesFourOfAKindAsSumOfAllDice() {
        assertThat(YachtScoreCalculator.calculateScore(
                ScoreCategory.FOUR_OF_A_KIND,
                new int[]{4, 4, 4, 4, 2}
        )).isEqualTo(18);
    }

    @Test
    void allowsYachtDiceForFourOfAKindScore() {
        assertThat(YachtScoreCalculator.calculateScore(
                ScoreCategory.FOUR_OF_A_KIND,
                new int[]{6, 6, 6, 6, 6}
        )).isEqualTo(30);
    }

    @Test
    void scoresZeroWhenFourOfAKindIsNotSatisfied() {
        assertThat(YachtScoreCalculator.calculateScore(
                ScoreCategory.FOUR_OF_A_KIND,
                new int[]{3, 3, 3, 2, 2}
        )).isZero();
    }

    @Test
    void calculatesFullHouseAsSumOfAllDice() {
        assertThat(YachtScoreCalculator.calculateScore(
                ScoreCategory.FULL_HOUSE,
                new int[]{2, 2, 5, 5, 5}
        )).isEqualTo(19);
    }

    @Test
    void scoresZeroWhenFullHouseIsNotSatisfiedOrDiceAreYacht() {
        assertThat(YachtScoreCalculator.calculateScore(
                ScoreCategory.FULL_HOUSE,
                new int[]{3, 3, 3, 2, 1}
        )).isZero();
        assertThat(YachtScoreCalculator.calculateScore(
                ScoreCategory.FULL_HOUSE,
                new int[]{6, 6, 6, 6, 6}
        )).isZero();
    }

    @Test
    void calculatesStraightAndYachtScores() {
        assertThat(YachtScoreCalculator.calculateScore(
                ScoreCategory.SMALL_STRAIGHT,
                new int[]{1, 2, 3, 4, 6}
        )).isEqualTo(15);
        assertThat(YachtScoreCalculator.calculateScore(
                ScoreCategory.LARGE_STRAIGHT,
                new int[]{2, 3, 4, 5, 6}
        )).isEqualTo(30);
        assertThat(YachtScoreCalculator.calculateScore(
                ScoreCategory.YACHT,
                new int[]{5, 5, 5, 5, 5}
        )).isEqualTo(50);
    }

    @Test
    void scoresZeroForUnsatisfiedPatternCategories() {
        int[] dice = {1, 2, 2, 4, 6};

        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.FOUR_OF_A_KIND, dice)).isZero();
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.FULL_HOUSE, dice)).isZero();
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.SMALL_STRAIGHT, dice)).isZero();
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.LARGE_STRAIGHT, dice)).isZero();
        assertThat(YachtScoreCalculator.calculateScore(ScoreCategory.YACHT, dice)).isZero();
    }

    @Test
    void calculatesOnlyUpperCategoriesForSubtotal() {
        Map<ScoreCategory, Integer> scores = upperScores(3);
        scores.put(ScoreCategory.CHOICE, 30);
        scores.put(ScoreCategory.YACHT, 50);

        assertThat(YachtScoreCalculator.calculateUpperSubtotal(scores)).isEqualTo(63);
    }

    @Test
    void scoresNoBonusBelowSixtyThreeUpperPoints() {
        assertThat(YachtScoreCalculator.calculateUpperBonus(upperScores(2))).isZero();
    }

    @Test
    void scoresThirtyFiveBonusAtSixtyThreeUpperPoints() {
        assertThat(YachtScoreCalculator.calculateUpperBonus(upperScores(3))).isEqualTo(35);
    }

    @Test
    void scoresThirtyFiveBonusAboveSixtyThreeUpperPoints() {
        assertThat(YachtScoreCalculator.calculateUpperBonus(upperScores(4))).isEqualTo(35);
    }

    @Test
    void rejectsNullCategory() {
        assertThatThrownBy(() -> YachtScoreCalculator.calculateScore(null, new int[]{1, 2, 3, 4, 5}))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("카테고리");
    }

    @Test
    void rejectsInvalidDiceThroughScoreCategoryValidation() {
        assertThatThrownBy(() -> YachtScoreCalculator.calculateScore(ScoreCategory.CHOICE, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> YachtScoreCalculator.calculateScore(
                ScoreCategory.CHOICE,
                new int[]{1, 2, 3, 4}
        )).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> YachtScoreCalculator.calculateScore(
                ScoreCategory.CHOICE,
                new int[]{1, 2, 3, 4, 7}
        )).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void producesSameScoreRegardlessOfDiceOrder() {
        assertThat(YachtScoreCalculator.calculateScore(
                ScoreCategory.FULL_HOUSE,
                new int[]{2, 2, 5, 5, 5}
        )).isEqualTo(YachtScoreCalculator.calculateScore(
                ScoreCategory.FULL_HOUSE,
                new int[]{5, 2, 5, 2, 5}
        ));
    }

    @Test
    void rejectsNullOrNegativeUpperScores() {
        assertThatThrownBy(() -> YachtScoreCalculator.calculateUpperSubtotal(null))
                .isInstanceOf(IllegalArgumentException.class);

        Map<ScoreCategory, Integer> scores = new EnumMap<>(ScoreCategory.class);
        scores.put(ScoreCategory.ACES, -1);

        assertThatThrownBy(() -> YachtScoreCalculator.calculateUpperSubtotal(scores))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static Map<ScoreCategory, Integer> upperScores(int acesScore) {
        Map<ScoreCategory, Integer> scores = new EnumMap<>(ScoreCategory.class);
        scores.put(ScoreCategory.ACES, acesScore);
        scores.put(ScoreCategory.DEUCES, 6);
        scores.put(ScoreCategory.THREES, 9);
        scores.put(ScoreCategory.FOURS, 12);
        scores.put(ScoreCategory.FIVES, 15);
        scores.put(ScoreCategory.SIXES, 18);
        return scores;
    }
}
