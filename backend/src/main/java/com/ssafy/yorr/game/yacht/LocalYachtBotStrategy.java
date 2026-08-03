package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.domain.YachtScoreCalculator;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class LocalYachtBotStrategy {

    public List<Boolean> chooseHeld(List<Integer> dice) {
        requireDice(dice);
        return keepStraightOrMostFrequent(dice);
    }

    public ScoreCategory chooseCategory(
            List<Integer> dice,
            List<ScoreCategory> openCategories
    ) {
        requireDice(dice);
        if (openCategories == null || openCategories.isEmpty()) {
            throw new IllegalArgumentException("at least one open category is required");
        }

        int[] values = dice.stream().mapToInt(Integer::intValue).toArray();
        List<CategoryScore> ranked = openCategories.stream()
                .map(category -> new CategoryScore(
                        category,
                        YachtScoreCalculator.calculateScore(category, values),
                        tieBreak(category)
                ))
                .sorted(Comparator.comparingInt(CategoryScore::score)
                        .thenComparingInt(CategoryScore::tieBreak)
                        .reversed())
                .toList();

        return ranked.getFirst().category();
    }

    private static List<Boolean> keepMostFrequentOrHigh(List<Integer> dice) {
        Map<Integer, Integer> counts = counts(dice);
        int target = counts.entrySet().stream()
                .max(Comparator.<Map.Entry<Integer, Integer>>comparingInt(Map.Entry::getValue)
                        .thenComparingInt(Map.Entry::getKey))
                .orElseThrow()
                .getKey();
        if (counts.get(target) == 1) {
            return dice.stream().map(die -> die >= 5).toList();
        }
        return dice.stream().map(die -> die == target).toList();
    }

    private static List<Boolean> keepStraightOrMostFrequent(List<Integer> dice) {
        List<Integer> bestWindow = bestStraightWindow(dice);
        if (bestWindow.size() >= 3) {
            List<Integer> remaining = new ArrayList<>(bestWindow);
            List<Boolean> held = new ArrayList<>(dice.size());
            for (int die : dice) {
                boolean keep = remaining.remove(Integer.valueOf(die));
                held.add(keep);
            }
            return List.copyOf(held);
        }
        return keepMostFrequentOrHigh(dice);
    }

    private static List<Integer> bestStraightWindow(List<Integer> dice) {
        List<Integer> best = List.of();
        for (int start = 1; start <= 3; start++) {
            List<Integer> window = new ArrayList<>();
            for (int face = start; face < start + 4; face++) {
                if (dice.contains(face)) {
                    window.add(face);
                }
            }
            if (window.size() > best.size()) {
                best = List.copyOf(window);
            }
        }
        return best;
    }

    private static Map<Integer, Integer> counts(List<Integer> dice) {
        Map<Integer, Integer> counts = new HashMap<>();
        dice.forEach(die -> counts.merge(die, 1, Integer::sum));
        return counts;
    }

    private static int tieBreak(ScoreCategory category) {
        return switch (category) {
            case YACHT -> 12;
            case LARGE_STRAIGHT -> 11;
            case FOUR_OF_A_KIND -> 10;
            case FULL_HOUSE -> 9;
            case CHOICE -> 8;
            case SMALL_STRAIGHT -> 7;
            case SIXES -> 6;
            case FIVES -> 5;
            case FOURS -> 4;
            case THREES -> 3;
            case DEUCES -> 2;
            case ACES -> 1;
        };
    }

    private static void requireDice(List<Integer> dice) {
        if (dice == null || dice.size() != 5 || dice.stream().anyMatch(die -> die == null || die < 1 || die > 6)) {
            throw new IllegalArgumentException("exactly five dice between 1 and 6 are required");
        }
    }

    private record CategoryScore(ScoreCategory category, int score, int tieBreak) {
    }
}
