package com.ssafy.yorr.game.round.domain;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RoundSubmissionTest {

    @Test
    void copiesDiceDefensively() {
        List<Integer> dice = new ArrayList<>(List.of(1, 2, 3, 4, 5));

        RoundSubmission submission = new RoundSubmission("player-a", 1, dice, "choice");
        dice.set(0, 6);

        assertThat(submission.dice()).containsExactly(1, 2, 3, 4, 5);
        assertThatThrownBy(() -> submission.dice().add(6))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void rejectsInvalidDice() {
        assertThatThrownBy(() -> new RoundSubmission(
                "player-a",
                1,
                List.of(1, 2, 3, 4, 7),
                "choice"
        )).isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                assertThat(exception.reason()).isEqualTo(RoundSynchronizationException.Reason.INVALID_DICE)
        );
    }

    @Test
    void rejectsUnknownCategory() {
        assertThatThrownBy(() -> new RoundSubmission(
                "player-a",
                1,
                List.of(1, 2, 3, 4, 5),
                "unknown"
        )).isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                assertThat(exception.reason()).isEqualTo(RoundSynchronizationException.Reason.INVALID_CATEGORY)
        );
    }
}
