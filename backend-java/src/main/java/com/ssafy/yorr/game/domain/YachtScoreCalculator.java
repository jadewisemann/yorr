package com.ssafy.yorr.game.domain;

import java.util.Arrays;
import java.util.EnumSet;
import java.util.Map;

public final class YachtScoreCalculator {
    private static final int SMALL_STRAIGHT_SCORE = 15;
    private static final int LARGE_STRAIGHT_SCORE = 30;
    private static final int YACHT_SCORE = 50;
    private static final int UPPER_BONUS_THRESHOLD = 63;
    private static final int UPPER_BONUS_SCORE = 35;
    private static final EnumSet<ScoreCategory> UPPER_CATEGORIES =
            EnumSet.range(ScoreCategory.ACES, ScoreCategory.SIXES);

    private YachtScoreCalculator() {
    }

    public static int calculateScore(ScoreCategory category, int[] dice) {
        if (category == null) {
            throw new IllegalArgumentException("점수 카테고리는 null일 수 없습니다.");
        }
        if (!category.isSatisfiedBy(dice)) {
            return 0;
        }

        return switch (category) {
            case ACES -> faceSum(dice, 1);
            case DEUCES -> faceSum(dice, 2);
            case THREES -> faceSum(dice, 3);
            case FOURS -> faceSum(dice, 4);
            case FIVES -> faceSum(dice, 5);
            case SIXES -> faceSum(dice, 6);
            case CHOICE, FOUR_OF_A_KIND, FULL_HOUSE -> sum(dice);
            case SMALL_STRAIGHT -> SMALL_STRAIGHT_SCORE;
            case LARGE_STRAIGHT -> LARGE_STRAIGHT_SCORE;
            case YACHT -> YACHT_SCORE;
        };
    }

    public static int calculateUpperSubtotal(Map<ScoreCategory, Integer> scores) {
        if (scores == null) {
            throw new IllegalArgumentException("카테고리별 점수는 null일 수 없습니다.");
        }

        return UPPER_CATEGORIES.stream()
                .mapToInt(category -> upperScoreOf(scores, category))
                .sum();
    }

    public static int calculateUpperBonus(Map<ScoreCategory, Integer> scores) {
        return calculateUpperSubtotal(scores) >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_SCORE : 0;
    }

    private static int upperScoreOf(Map<ScoreCategory, Integer> scores, ScoreCategory category) {
        if (!scores.containsKey(category)) {
            return 0;
        }

        Integer score = scores.get(category);
        if (score == null || score < 0) {
            throw new IllegalArgumentException("상단 카테고리 점수는 0 이상이어야 합니다.");
        }
        return score;
    }

    private static int faceSum(int[] dice, int face) {
        return Arrays.stream(dice)
                .filter(die -> die == face)
                .sum();
    }

    private static int sum(int[] dice) {
        return Arrays.stream(dice).sum();
    }
}
