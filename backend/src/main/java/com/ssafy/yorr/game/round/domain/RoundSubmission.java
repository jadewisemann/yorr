package com.ssafy.yorr.game.round.domain;

import java.util.List;
import java.util.Set;

public record RoundSubmission(
        String playerId,
        int roundNumber,
        List<Integer> dice,
        String category
) {

    private static final int DICE_COUNT = 5;
    private static final int MIN_DIE_VALUE = 1;
    private static final int MAX_DIE_VALUE = 6;
    private static final Set<String> SUPPORTED_CATEGORIES = Set.of(
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

    public RoundSubmission {
        if (playerId == null || playerId.isBlank()) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_PLAYER,
                    "playerId must not be blank"
            );
        }
        if (roundNumber < 1) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_ROUND,
                    "roundNumber must be at least 1"
            );
        }
        if (dice == null || dice.size() != DICE_COUNT || dice.stream().anyMatch(RoundSubmission::isInvalidDie)) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_DICE,
                    "dice must contain exactly five values between 1 and 6"
            );
        }
        if (category == null || !SUPPORTED_CATEGORIES.contains(category)) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_CATEGORY,
                    "unsupported category: " + category
            );
        }

        dice = List.copyOf(dice);
    }

    private static boolean isInvalidDie(Integer die) {
        return die == null || die < MIN_DIE_VALUE || die > MAX_DIE_VALUE;
    }
}
