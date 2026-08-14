package com.ssafy.yorr.game.service;

import com.ssafy.yorr.game.dto.ScoreCandidatesResponse;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.entry;

class ScoreCandidateServiceTest {
    private static final List<String> CATEGORY_KEYS = List.of(
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

    private final ScoreCandidateService scoreCandidateService = new ScoreCandidateService();

    @Test
    void returnsAllCategoriesInApiOrder() {
        ScoreCandidatesResponse response = scoreCandidateService.calculate(List.of(1, 2, 3, 4, 5));

        assertThat(response.candidates()).hasSize(12);
        assertThat(response.candidates().keySet()).containsExactlyElementsOf(CATEGORY_KEYS);
    }

    @Test
    void calculatesExpectedScoresForFullHouseDice() {
        ScoreCandidatesResponse response = scoreCandidateService.calculate(List.of(3, 3, 3, 5, 5));

        assertThat(response.candidates()).containsExactly(
                entry("ones", 0),
                entry("twos", 0),
                entry("threes", 9),
                entry("fours", 0),
                entry("fives", 10),
                entry("sixes", 0),
                entry("choice", 19),
                entry("fourOfAKind", 0),
                entry("fullHouse", 19),
                entry("smallStraight", 0),
                entry("largeStraight", 0),
                entry("yacht", 0)
        );
    }

    @Test
    void calculatesYachtAndFourOfAKindCandidates() {
        ScoreCandidatesResponse yacht = scoreCandidateService.calculate(List.of(6, 6, 6, 6, 6));
        ScoreCandidatesResponse fourOfAKind = scoreCandidateService.calculate(List.of(4, 4, 4, 4, 2));

        assertThat(yacht.candidates())
                .containsEntry("fourOfAKind", 30)
                .containsEntry("yacht", 50);
        assertThat(fourOfAKind.candidates())
                .containsEntry("fourOfAKind", 18)
                .containsEntry("yacht", 0);
    }

    @Test
    void calculatesStraightCandidates() {
        ScoreCandidatesResponse largeStraight = scoreCandidateService.calculate(List.of(2, 3, 4, 5, 6));
        ScoreCandidatesResponse smallStraight = scoreCandidateService.calculate(List.of(1, 2, 3, 4, 6));

        assertThat(largeStraight.candidates())
                .containsEntry("smallStraight", 15)
                .containsEntry("largeStraight", 30);
        assertThat(smallStraight.candidates())
                .containsEntry("smallStraight", 15)
                .containsEntry("largeStraight", 0);
    }

    @Test
    void returnsZeroForUnsatisfiedPatternCategories() {
        ScoreCandidatesResponse response = scoreCandidateService.calculate(List.of(1, 2, 2, 4, 6));

        assertThat(response.candidates())
                .containsEntry("fourOfAKind", 0)
                .containsEntry("fullHouse", 0)
                .containsEntry("smallStraight", 0)
                .containsEntry("largeStraight", 0)
                .containsEntry("yacht", 0);
    }

    @Test
    void doesNotModifyInputList() {
        List<Integer> dice = new ArrayList<>(List.of(3, 3, 3, 5, 5));
        List<Integer> original = List.copyOf(dice);

        scoreCandidateService.calculate(dice);

        assertThat(dice).containsExactlyElementsOf(original);
    }

    @Test
    void returnsUnmodifiableCandidates() {
        ScoreCandidatesResponse response = scoreCandidateService.calculate(List.of(1, 2, 3, 4, 5));

        assertThatThrownBy(() -> response.candidates().put("extra", 0))
                .isInstanceOf(UnsupportedOperationException.class);
    }
}
