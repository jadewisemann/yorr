package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.domain.YachtScoreCalculator;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class ExpectimaxYachtBotPolicy {

    private static final int DICE_COUNT = 5;
    private static final int FACE_COUNT = 6;
    private static final int MAX_ROLL_COUNT = 3;
    private static final double EARLY_SCORE_MARGIN = 0.15;
    private static final List<List<DiceOutcome>> OUTCOMES_BY_DICE_COUNT = createOutcomeTable();

    private final ScorecardValueEvaluator valueEvaluator;

    public ExpectimaxYachtBotPolicy(ScorecardValueEvaluator valueEvaluator) {
        this.valueEvaluator = valueEvaluator;
    }

    public BotDecision decide(ScoreBoard board, List<Integer> dice, int rollCount) {
        requireState(board, dice, rollCount);
        Search search = new Search(board);
        int[] diceCounts = counts(dice);
        ScoreChoice scoreChoice = search.bestScore(diceCounts);
        if (rollCount == MAX_ROLL_COUNT) {
            return BotDecision.score(scoreChoice.category(), scoreChoice.utility());
        }

        HoldChoice holdChoice = search.bestHold(diceCounts, MAX_ROLL_COUNT - rollCount);
        if (scoreChoice.utility() + EARLY_SCORE_MARGIN >= holdChoice.expectedUtility()) {
            return BotDecision.score(scoreChoice.category(), scoreChoice.utility());
        }
        return BotDecision.hold(
                toHeldFlags(dice, holdChoice.heldCounts()),
                holdChoice.expectedUtility()
        );
    }

    private final class Search {

        private final ScoreBoard board;
        private final EnumSet<ScoreCategory> openCategories;
        private final Map<Long, Double> memoizedValues = new HashMap<>();

        private Search(ScoreBoard board) {
            this.board = board;
            this.openCategories = openCategories(board);
        }

        private double stateValue(int[] diceCounts, int rerollsRemaining) {
            long key = ((long) rerollsRemaining << 32) | Integer.toUnsignedLong(encode(diceCounts));
            Double memoized = memoizedValues.get(key);
            if (memoized != null) {
                return memoized;
            }
            double calculated = calculateStateValue(diceCounts, rerollsRemaining);
            memoizedValues.put(key, calculated);
            return calculated;
        }

        private double calculateStateValue(int[] diceCounts, int rerollsRemaining) {
            double scoreValue = bestScore(diceCounts).utility();
            if (rerollsRemaining == 0) {
                return scoreValue;
            }
            return Math.max(scoreValue, bestHold(diceCounts, rerollsRemaining).expectedUtility());
        }

        private ScoreChoice bestScore(int[] diceCounts) {
            int[] dice = expand(diceCounts);
            boolean choiceDominatedBySmallStraight =
                    openCategories.contains(ScoreCategory.SMALL_STRAIGHT)
                            && ScoreCategory.SMALL_STRAIGHT.isSatisfiedBy(dice);
            ScoreChoice best = null;
            for (ScoreCategory category : openCategories) {
                if (category == ScoreCategory.CHOICE && choiceDominatedBySmallStraight) {
                    continue;
                }
                int score = YachtScoreCalculator.calculateScore(category, dice);
                double utility = valueEvaluator.categoryUtility(board, category, score);
                ScoreChoice candidate = new ScoreChoice(category, utility);
                if (best == null || candidate.isBetterThan(best)) {
                    best = candidate;
                }
            }
            if (best == null) {
                throw new IllegalStateException("AI bot has no open score category");
            }
            return best;
        }

        private HoldChoice bestHold(int[] diceCounts, int rerollsRemaining) {
            HoldChoice best = null;
            for (HoldPattern pattern : holdPatterns(diceCounts)) {
                int rerolledDiceCount = DICE_COUNT - Arrays.stream(pattern.counts()).sum();
                double expectedUtility = 0;
                for (DiceOutcome outcome : OUTCOMES_BY_DICE_COUNT.get(rerolledDiceCount)) {
                    int[] nextDice = add(pattern.counts(), outcome.counts());
                    expectedUtility += outcome.probability()
                            * stateValue(nextDice, rerollsRemaining - 1);
                }
                HoldChoice candidate = new HoldChoice(pattern.counts(), expectedUtility);
                if (best == null || candidate.isBetterThan(best)) {
                    best = candidate;
                }
            }
            if (best == null) {
                throw new IllegalStateException("AI bot has no legal reroll action");
            }
            return best;
        }
    }

    public enum Action {
        HOLD,
        SCORE
    }

    public record BotDecision(
            Action action,
            List<Boolean> held,
            ScoreCategory category,
            double expectedUtility
    ) {
        static BotDecision hold(List<Boolean> held, double expectedUtility) {
            return new BotDecision(Action.HOLD, List.copyOf(held), null, expectedUtility);
        }

        static BotDecision score(ScoreCategory category, double expectedUtility) {
            return new BotDecision(Action.SCORE, List.of(), category, expectedUtility);
        }
    }

    private record ScoreChoice(ScoreCategory category, double utility) {
        boolean isBetterThan(ScoreChoice other) {
            int utilityComparison = Double.compare(utility, other.utility);
            return utilityComparison > 0
                    || (utilityComparison == 0 && category.ordinal() > other.category.ordinal());
        }
    }

    private record HoldChoice(int[] heldCounts, double expectedUtility) {
        boolean isBetterThan(HoldChoice other) {
            int utilityComparison = Double.compare(expectedUtility, other.expectedUtility);
            if (utilityComparison != 0) {
                return utilityComparison > 0;
            }
            return Arrays.stream(heldCounts).sum() > Arrays.stream(other.heldCounts).sum();
        }
    }

    private record HoldPattern(int[] counts) {
    }

    private record DiceOutcome(int[] counts, double probability) {
    }

    private static List<HoldPattern> holdPatterns(int[] diceCounts) {
        Map<Integer, HoldPattern> unique = new LinkedHashMap<>();
        collectHoldPatterns(diceCounts, 0, new int[FACE_COUNT], unique);
        return List.copyOf(unique.values());
    }

    private static void collectHoldPatterns(
            int[] diceCounts,
            int faceIndex,
            int[] heldCounts,
            Map<Integer, HoldPattern> patterns
    ) {
        if (faceIndex == FACE_COUNT) {
            if (Arrays.stream(heldCounts).sum() < DICE_COUNT) {
                int[] copy = heldCounts.clone();
                patterns.put(encode(copy), new HoldPattern(copy));
            }
            return;
        }
        for (int kept = 0; kept <= diceCounts[faceIndex]; kept++) {
            heldCounts[faceIndex] = kept;
            collectHoldPatterns(diceCounts, faceIndex + 1, heldCounts, patterns);
        }
        heldCounts[faceIndex] = 0;
    }

    private static List<List<DiceOutcome>> createOutcomeTable() {
        List<List<DiceOutcome>> table = new ArrayList<>(DICE_COUNT + 1);
        for (int diceCount = 0; diceCount <= DICE_COUNT; diceCount++) {
            List<DiceOutcome> outcomes = new ArrayList<>();
            collectOutcomes(diceCount, 0, new int[FACE_COUNT], outcomes);
            table.add(List.copyOf(outcomes));
        }
        return List.copyOf(table);
    }

    private static void collectOutcomes(
            int remaining,
            int faceIndex,
            int[] counts,
            List<DiceOutcome> outcomes
    ) {
        if (faceIndex == FACE_COUNT - 1) {
            counts[faceIndex] = remaining;
            int[] copy = counts.clone();
            outcomes.add(new DiceOutcome(copy, outcomeProbability(copy)));
            counts[faceIndex] = 0;
            return;
        }
        for (int count = 0; count <= remaining; count++) {
            counts[faceIndex] = count;
            collectOutcomes(remaining - count, faceIndex + 1, counts, outcomes);
        }
        counts[faceIndex] = 0;
    }

    private static double outcomeProbability(int[] counts) {
        int total = Arrays.stream(counts).sum();
        long permutations = factorial(total);
        for (int count : counts) {
            permutations /= factorial(count);
        }
        return permutations / Math.pow(FACE_COUNT, total);
    }

    private static long factorial(int value) {
        long result = 1;
        for (int factor = 2; factor <= value; factor++) {
            result *= factor;
        }
        return result;
    }

    private static int[] counts(List<Integer> dice) {
        int[] counts = new int[FACE_COUNT];
        dice.forEach(die -> counts[die - 1]++);
        return counts;
    }

    private static int[] add(int[] first, int[] second) {
        int[] result = new int[FACE_COUNT];
        for (int index = 0; index < FACE_COUNT; index++) {
            result[index] = first[index] + second[index];
        }
        return result;
    }

    private static int[] expand(int[] counts) {
        int[] dice = new int[DICE_COUNT];
        int index = 0;
        for (int faceIndex = 0; faceIndex < FACE_COUNT; faceIndex++) {
            for (int count = 0; count < counts[faceIndex]; count++) {
                dice[index++] = faceIndex + 1;
            }
        }
        return dice;
    }

    private static List<Boolean> toHeldFlags(List<Integer> dice, int[] heldCounts) {
        int[] remaining = heldCounts.clone();
        List<Boolean> flags = new ArrayList<>(DICE_COUNT);
        for (int die : dice) {
            boolean held = remaining[die - 1] > 0;
            flags.add(held);
            if (held) {
                remaining[die - 1]--;
            }
        }
        return List.copyOf(flags);
    }

    private static int encode(int[] counts) {
        int encoded = 0;
        int place = 1;
        for (int count : counts) {
            encoded += count * place;
            place *= DICE_COUNT + 1;
        }
        return encoded;
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

    private static void requireState(ScoreBoard board, List<Integer> dice, int rollCount) {
        if (board == null) {
            throw new IllegalArgumentException("scoreboard is required");
        }
        if (dice == null
                || dice.size() != DICE_COUNT
                || dice.stream().anyMatch(die -> die == null || die < 1 || die > FACE_COUNT)) {
            throw new IllegalArgumentException("exactly five dice between 1 and 6 are required");
        }
        if (rollCount < 1 || rollCount > MAX_ROLL_COUNT) {
            throw new IllegalArgumentException("roll count must be between 1 and 3");
        }
    }
}
