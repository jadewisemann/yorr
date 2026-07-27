package com.ssafy.yorr.game.domain;

import java.util.Arrays;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Collectors;

public enum ScoreCategory {
    ACES("ones", "에이스", "1의 합", dice -> containsFace(dice, 1)),
    DEUCES("twos", "듀스", "2의 합", dice -> containsFace(dice, 2)),
    THREES("threes", "트레이", "3의 합", dice -> containsFace(dice, 3)),
    FOURS("fours", "포", "4의 합", dice -> containsFace(dice, 4)),
    FIVES("fives", "파이브", "5의 합", dice -> containsFace(dice, 5)),
    SIXES("sixes", "식스", "6의 합", dice -> containsFace(dice, 6)),
    CHOICE("choice", "초이스", "모든 주사위의 합", dice -> true),
    FOUR_OF_A_KIND("fourOfAKind", "포커", "같은 눈 4개 이상", ScoreCategory::isFourOfAKind),
    FULL_HOUSE("fullHouse", "풀하우스", "같은 눈 3개와 2개", ScoreCategory::isFullHouse),
    SMALL_STRAIGHT("smallStraight", "스몰 스트레이트", "연속된 눈 4개", dice -> hasRun(dice, 4)),
    LARGE_STRAIGHT("largeStraight", "라지 스트레이트", "연속된 눈 5개", dice -> hasRun(dice, 5)),
    YACHT("yacht", "요트", "같은 눈 5개", dice -> counts(dice).size() == 1);

    private static final int DICE_COUNT = 5;
    private static final int MIN_FACE = 1;
    private static final int MAX_FACE = 6;
    private static final Map<String, ScoreCategory> BY_API_KEY = Arrays.stream(values())
            .collect(Collectors.toUnmodifiableMap(ScoreCategory::apiKey, Function.identity()));

    private final String apiKey;
    private final String label;
    private final String description;
    private final Predicate<int[]> matcher;

    ScoreCategory(String apiKey, String label, String description, Predicate<int[]> matcher) {
        this.apiKey = apiKey;
        this.label = label;
        this.description = description;
        this.matcher = matcher;
    }

    public String apiKey() {
        return apiKey;
    }

    public String getLabel() {
        return label;
    }

    public String getDescription() {
        return description;
    }

    public boolean isSatisfiedBy(int[] dice) {
        validateDice(dice);
        return matcher.test(dice);
    }

    public boolean isUpperCategory() {
        return ordinal() <= SIXES.ordinal();
    }

    public static ScoreCategory fromApiKey(String apiKey) {
        ScoreCategory category = BY_API_KEY.get(apiKey);
        if (category == null) {
            throw new IllegalArgumentException("지원하지 않는 점수 카테고리입니다: " + apiKey);
        }
        return category;
    }

    private static void validateDice(int[] dice) {
        if (dice == null) {
            throw new IllegalArgumentException("주사위는 null일 수 없습니다.");
        }
        if (dice.length != DICE_COUNT) {
            throw new IllegalArgumentException("주사위는 정확히 5개여야 합니다.");
        }
        if (Arrays.stream(dice).anyMatch(die -> die < MIN_FACE || die > MAX_FACE)) {
            throw new IllegalArgumentException("주사위 눈은 1부터 6 사이여야 합니다.");
        }
    }

    private static boolean containsFace(int[] dice, int face) {
        return Arrays.stream(dice).anyMatch(die -> die == face);
    }

    private static boolean isFourOfAKind(int[] dice) {
        return counts(dice).values().stream().anyMatch(count -> count >= 4);
    }

    private static boolean isFullHouse(int[] dice) {
        var values = counts(dice).values();
        return values.size() == 2 && values.contains(2L) && values.contains(3L);
    }

    private static boolean hasRun(int[] dice, int length) {
        boolean[] faces = new boolean[MAX_FACE + 1];
        for (int die : dice) {
            faces[die] = true;
        }

        int run = 0;
        for (int face = MIN_FACE; face <= MAX_FACE; face++) {
            run = faces[face] ? run + 1 : 0;
            if (run >= length) {
                return true;
            }
        }
        return false;
    }

    private static Map<Integer, Long> counts(int[] dice) {
        return Arrays.stream(dice).boxed()
                .collect(Collectors.groupingBy(value -> value, Collectors.counting()));
    }
}
