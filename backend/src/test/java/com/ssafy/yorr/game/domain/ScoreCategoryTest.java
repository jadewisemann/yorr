package com.ssafy.yorr.game.domain;

import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScoreCategoryTest {

    @Test
    void mapsEveryCategoryToItsApiKeyAndBack() {
        assertThat(Arrays.stream(ScoreCategory.values()).map(ScoreCategory::apiKey))
                .containsExactly(
                        "ones",
                        "twos",
                        "threes",
                        "fours",
                        "fives",
                        "sixes",
                        "choice",
                        "fourOfAKind",
                        "fullHouse",
                        "smallStraight",
                        "largeStraight",
                        "yacht"
                );
        for (ScoreCategory category : ScoreCategory.values()) {
            assertThat(ScoreCategory.fromApiKey(category.apiKey())).isEqualTo(category);
        }
    }

    @Test
    void rejectsUnknownApiKey() {
        assertThatThrownBy(() -> ScoreCategory.fromApiKey("unknown"))
                .isInstanceOf(IllegalArgumentException.class);
    }


    @Test
    void definesTwelveCategoriesInExpectedOrder() {
        assertThat(ScoreCategory.values()).containsExactly(
                ScoreCategory.ACES,
                ScoreCategory.DEUCES,
                ScoreCategory.THREES,
                ScoreCategory.FOURS,
                ScoreCategory.FIVES,
                ScoreCategory.SIXES,
                ScoreCategory.CHOICE,
                ScoreCategory.FOUR_OF_A_KIND,
                ScoreCategory.FULL_HOUSE,
                ScoreCategory.SMALL_STRAIGHT,
                ScoreCategory.LARGE_STRAIGHT,
                ScoreCategory.YACHT
        );
    }

    @Test
    void providesLabelsAndDescriptionsForEveryCategory() {
        assertThat(Arrays.stream(ScoreCategory.values()).map(ScoreCategory::getLabel))
                .allSatisfy(label -> assertThat(label).isNotBlank());
        assertThat(Arrays.stream(ScoreCategory.values()).map(ScoreCategory::getDescription))
                .allSatisfy(description -> assertThat(description).isNotBlank());
    }

    @Test
    void satisfiesUpperCategoriesWhenMatchingFaceExists() {
        int[] dice = {1, 2, 3, 4, 5};

        assertThat(ScoreCategory.ACES.isSatisfiedBy(dice)).isTrue();
        assertThat(ScoreCategory.DEUCES.isSatisfiedBy(dice)).isTrue();
        assertThat(ScoreCategory.THREES.isSatisfiedBy(dice)).isTrue();
        assertThat(ScoreCategory.FOURS.isSatisfiedBy(dice)).isTrue();
        assertThat(ScoreCategory.FIVES.isSatisfiedBy(dice)).isTrue();
        assertThat(ScoreCategory.SIXES.isSatisfiedBy(dice)).isFalse();
    }

    @Test
    void alwaysSatisfiesChoiceForValidDice() {
        assertThat(ScoreCategory.CHOICE.isSatisfiedBy(new int[]{1, 1, 2, 4, 6})).isTrue();
    }

    @Test
    void satisfiesFourOfAKindWithFourOrFiveMatchingDice() {
        assertThat(ScoreCategory.FOUR_OF_A_KIND.isSatisfiedBy(new int[]{4, 4, 4, 4, 2})).isTrue();
        assertThat(ScoreCategory.FOUR_OF_A_KIND.isSatisfiedBy(new int[]{6, 6, 6, 6, 6})).isTrue();
        assertThat(ScoreCategory.FOUR_OF_A_KIND.isSatisfiedBy(new int[]{3, 3, 3, 2, 2})).isFalse();
    }

    @Test
    void satisfiesFullHouseOnlyWithThreeAndTwoMatchingDice() {
        assertThat(ScoreCategory.FULL_HOUSE.isSatisfiedBy(new int[]{2, 5, 2, 5, 5})).isTrue();
        assertThat(ScoreCategory.FULL_HOUSE.isSatisfiedBy(new int[]{6, 6, 6, 6, 6})).isFalse();
        assertThat(ScoreCategory.FULL_HOUSE.isSatisfiedBy(new int[]{3, 3, 3, 2, 1})).isFalse();
    }

    @Test
    void satisfiesSmallStraightAfterRemovingDuplicates() {
        assertThat(ScoreCategory.SMALL_STRAIGHT.isSatisfiedBy(new int[]{1, 2, 3, 4, 6})).isTrue();
        assertThat(ScoreCategory.SMALL_STRAIGHT.isSatisfiedBy(new int[]{2, 3, 4, 5, 5})).isTrue();
        assertThat(ScoreCategory.SMALL_STRAIGHT.isSatisfiedBy(new int[]{3, 3, 4, 5, 6})).isTrue();
        assertThat(ScoreCategory.SMALL_STRAIGHT.isSatisfiedBy(new int[]{1, 2, 2, 4, 5})).isFalse();
    }

    @Test
    void satisfiesLargeStraightOnlyWithFiveConsecutiveFaces() {
        assertThat(ScoreCategory.LARGE_STRAIGHT.isSatisfiedBy(new int[]{1, 2, 3, 4, 5})).isTrue();
        assertThat(ScoreCategory.LARGE_STRAIGHT.isSatisfiedBy(new int[]{6, 2, 5, 3, 4})).isTrue();
        assertThat(ScoreCategory.LARGE_STRAIGHT.isSatisfiedBy(new int[]{1, 2, 3, 4, 4})).isFalse();
        assertThat(ScoreCategory.LARGE_STRAIGHT.isSatisfiedBy(new int[]{1, 2, 3, 5, 6})).isFalse();
    }

    @Test
    void satisfiesYachtOnlyWhenAllDiceMatch() {
        assertThat(ScoreCategory.YACHT.isSatisfiedBy(new int[]{5, 5, 5, 5, 5})).isTrue();
        assertThat(ScoreCategory.YACHT.isSatisfiedBy(new int[]{5, 5, 5, 5, 4})).isFalse();
    }

    @Test
    void ignoresDiceOrder() {
        assertThat(ScoreCategory.FULL_HOUSE.isSatisfiedBy(new int[]{2, 2, 5, 5, 5}))
                .isEqualTo(ScoreCategory.FULL_HOUSE.isSatisfiedBy(new int[]{5, 2, 5, 2, 5}));
        assertThat(ScoreCategory.LARGE_STRAIGHT.isSatisfiedBy(new int[]{1, 2, 3, 4, 5}))
                .isEqualTo(ScoreCategory.LARGE_STRAIGHT.isSatisfiedBy(new int[]{5, 3, 1, 4, 2}));
    }

    @Test
    void rejectsNullDice() {
        assertThatThrownBy(() -> ScoreCategory.CHOICE.isSatisfiedBy(null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsFourDice() {
        assertThatThrownBy(() -> ScoreCategory.CHOICE.isSatisfiedBy(new int[]{1, 2, 3, 4}))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsSixDice() {
        assertThatThrownBy(() -> ScoreCategory.CHOICE.isSatisfiedBy(new int[]{1, 2, 3, 4, 5, 6}))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsZeroFace() {
        assertThatThrownBy(() -> ScoreCategory.CHOICE.isSatisfiedBy(new int[]{0, 1, 2, 3, 4}))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsSevenFace() {
        assertThatThrownBy(() -> ScoreCategory.CHOICE.isSatisfiedBy(new int[]{1, 2, 3, 4, 7}))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
