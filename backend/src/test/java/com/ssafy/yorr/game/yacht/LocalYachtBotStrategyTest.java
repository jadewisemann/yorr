package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.domain.ScoreCategory;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class LocalYachtBotStrategyTest {

    private final LocalYachtBotStrategy strategy = new LocalYachtBotStrategy();

    @Test
    void keepsTheMostFrequentHighFace() {
        assertThat(strategy.chooseHeld(
                List.of(2, 6, 2, 4, 2)
        )).containsExactly(true, false, true, false, true);
    }

    @Test
    void keepsUniqueDiceThatAreCloseToAStraight() {
        assertThat(strategy.chooseHeld(
                List.of(2, 3, 4, 4, 6)
        )).containsExactly(true, true, true, false, false);
    }

    @Test
    void categoryChoiceNeverUsesAClosedCategory() {
        ScoreCategory selected = strategy.chooseCategory(
                List.of(6, 6, 6, 6, 6),
                List.of(ScoreCategory.ACES, ScoreCategory.CHOICE)
        );

        assertThat(selected).isEqualTo(ScoreCategory.CHOICE);
    }

    @Test
    void categoryChoiceSelectsTheHighestScore() {
        ScoreCategory selected = strategy.chooseCategory(
                List.of(6, 6, 6, 6, 6),
                List.of(ScoreCategory.SIXES, ScoreCategory.CHOICE, ScoreCategory.YACHT)
        );

        assertThat(selected).isEqualTo(ScoreCategory.YACHT);
    }
}
