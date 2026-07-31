package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

class ExpectimaxYachtBotPolicyTest {

    private final ExpectimaxYachtBotPolicy policy =
            new ExpectimaxYachtBotPolicy(new ScorecardValueEvaluator());

    @Test
    void keepsFourMatchingHighDiceForTheExpectedYachtValue() {
        var decision = policy.decide(emptyBoard(), List.of(6, 6, 1, 6, 6), 1);

        assertThat(decision.action()).isEqualTo(ExpectimaxYachtBotPolicy.Action.HOLD);
        assertThat(decision.held()).containsExactly(true, true, false, true, true);
    }

    @Test
    void keepsAUniqueFourDieRunForTheLargeStraightChance() {
        var decision = policy.decide(emptyBoard(), List.of(2, 3, 4, 5, 5), 1);

        assertThat(decision.action()).isEqualTo(ExpectimaxYachtBotPolicy.Action.HOLD);
        assertThat(decision.held()).containsExactly(true, true, true, true, false);
    }

    @Test
    void submitsTheBestCategoryAfterTheThirdRoll() {
        var decision = policy.decide(emptyBoard(), List.of(6, 6, 6, 6, 6), 3);

        assertThat(decision.action()).isEqualTo(ExpectimaxYachtBotPolicy.Action.SCORE);
        assertThat(decision.category()).isEqualTo(ScoreCategory.YACHT);
    }

    @Test
    void securesTheUpperBonusWhenFiveSixesAreAUniqueOpportunity() {
        ScoreBoard board = board(
                Map.of(
                        ScoreCategory.ACES, 3,
                        ScoreCategory.DEUCES, 6,
                        ScoreCategory.THREES, 9,
                        ScoreCategory.FOURS, 0,
                        ScoreCategory.FIVES, 15
                ),
                33
        );

        var decision = policy.decide(board, List.of(6, 6, 6, 6, 6), 3);

        assertThat(decision.category()).isEqualTo(ScoreCategory.SIXES);
    }

    @Test
    void recordsZeroInYachtToPreserveTheLastUpperBonusChance() {
        EnumMap<ScoreCategory, Integer> filled = new EnumMap<>(ScoreCategory.class);
        for (ScoreCategory category : ScoreCategory.values()) {
            if (category != ScoreCategory.SIXES && category != ScoreCategory.YACHT) {
                filled.put(category, category.isUpperCategory() ? 12 : 0);
            }
        }
        ScoreBoard board = board(filled, 60);

        var decision = policy.decide(board, List.of(1, 2, 3, 4, 5), 3);

        assertThat(decision.category()).isEqualTo(ScoreCategory.YACHT);
    }

    @Test
    void searchesTwoRemainingRollsWithinTheTurnLatencyBudget() {
        assertThatCode(() -> policy.decide(emptyBoard(), List.of(1, 2, 3, 5, 6), 1))
                .doesNotThrowAnyException();

        long startedAt = System.nanoTime();
        policy.decide(emptyBoard(), List.of(1, 2, 3, 5, 6), 1);
        Duration elapsed = Duration.ofNanos(System.nanoTime() - startedAt);

        assertThat(elapsed).isLessThan(Duration.ofSeconds(1));
    }

    private static ScoreBoard emptyBoard() {
        return new ScoreBoard(Map.of(), 0, 0, 0);
    }

    private static ScoreBoard board(Map<ScoreCategory, Integer> filled, int upperSubtotal) {
        Map<String, Integer> categories = new HashMap<>();
        filled.forEach((category, score) -> categories.put(category.apiKey(), score));
        int total = filled.values().stream().mapToInt(Integer::intValue).sum();
        return new ScoreBoard(categories, upperSubtotal, 0, total);
    }
}
