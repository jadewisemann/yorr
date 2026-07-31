package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import org.springframework.stereotype.Component;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;

@Component
public class ScorecardValueEvaluator {

    static final int UPPER_BONUS_THRESHOLD = 63;
    static final int UPPER_BONUS_SCORE = 35;
    private static final double SECURED_BONUS_PREMIUM = 4.0;
    private static final double BONUS_CURVE_SCALE = 5.0;
    private static final Map<ScoreCategory, Double> BASELINE_VALUES = baselineValues();

    public double categoryUtility(ScoreBoard board, ScoreCategory category, int score) {
        requireOpen(board, category);

        EnumSet<ScoreCategory> remaining = openCategories(board);
        remaining.remove(category);
        int nextUpperSubtotal = board.upperSubtotal()
                + (category.isUpperCategory() ? score : 0);
        boolean bonusSecured = board.upperSubtotal() < UPPER_BONUS_THRESHOLD
                && nextUpperSubtotal >= UPPER_BONUS_THRESHOLD;
        double immediateValue = score + (bonusSecured ? UPPER_BONUS_SCORE : 0);
        if (bonusSecured) {
            immediateValue += SECURED_BONUS_PREMIUM;
        }
        return immediateValue + remainingPotential(remaining, nextUpperSubtotal);
    }

    double remainingPotential(ScoreBoard board) {
        return remainingPotential(openCategories(board), board.upperSubtotal());
    }

    private static double remainingPotential(
            EnumSet<ScoreCategory> remaining,
            int upperSubtotal
    ) {
        double categoryPotential = remaining.stream()
                .mapToDouble(BASELINE_VALUES::get)
                .sum();
        return categoryPotential + upperBonusPotential(remaining, upperSubtotal);
    }

    private static double upperBonusPotential(
            EnumSet<ScoreCategory> remaining,
            int upperSubtotal
    ) {
        if (upperSubtotal >= UPPER_BONUS_THRESHOLD) {
            return 0;
        }

        int maximumRemaining = remaining.stream()
                .filter(ScoreCategory::isUpperCategory)
                .mapToInt(category -> (category.ordinal() + 1) * 5)
                .sum();
        if (upperSubtotal + maximumRemaining < UPPER_BONUS_THRESHOLD) {
            return 0;
        }

        double expectedRemaining = remaining.stream()
                .filter(ScoreCategory::isUpperCategory)
                .mapToDouble(BASELINE_VALUES::get)
                .sum();
        double distance = upperSubtotal + expectedRemaining - UPPER_BONUS_THRESHOLD;
        double probability = 1.0 / (1.0 + Math.exp(-distance / BONUS_CURVE_SCALE));
        return UPPER_BONUS_SCORE * probability;
    }

    private static EnumSet<ScoreCategory> openCategories(ScoreBoard board) {
        EnumSet<ScoreCategory> open = EnumSet.noneOf(ScoreCategory.class);
        for (ScoreCategory category : ScoreCategory.values()) {
            if (board.categories().get(category.apiKey()) == null) {
                open.add(category);
            }
        }
        return open;
    }

    private static void requireOpen(ScoreBoard board, ScoreCategory category) {
        if (board == null || category == null) {
            throw new IllegalArgumentException("scoreboard and category are required");
        }
        if (board.categories().get(category.apiKey()) != null) {
            throw new IllegalArgumentException("category is already filled: " + category);
        }
    }

    private static Map<ScoreCategory, Double> baselineValues() {
        EnumMap<ScoreCategory, Double> values = new EnumMap<>(ScoreCategory.class);
        values.put(ScoreCategory.ACES, 2.0);
        values.put(ScoreCategory.DEUCES, 5.0);
        values.put(ScoreCategory.THREES, 8.0);
        values.put(ScoreCategory.FOURS, 12.0);
        values.put(ScoreCategory.FIVES, 15.0);
        values.put(ScoreCategory.SIXES, 18.0);
        values.put(ScoreCategory.CHOICE, 20.0);
        values.put(ScoreCategory.FOUR_OF_A_KIND, 10.0);
        values.put(ScoreCategory.FULL_HOUSE, 8.0);
        values.put(ScoreCategory.SMALL_STRAIGHT, 12.0);
        values.put(ScoreCategory.LARGE_STRAIGHT, 7.0);
        values.put(ScoreCategory.YACHT, 3.0);
        return Map.copyOf(values);
    }
}
