package com.ssafy.yorr.game.dto;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScoreConfirmationCommandTest {

    @Test
    void copiesDiceDefensively() {
        List<Integer> dice = new ArrayList<>(List.of(1, 2, 3, 4, 5));

        ScoreConfirmationCommand command =
                new ScoreConfirmationCommand("game-1", "player-1", 1, "choice", dice);
        dice.set(0, 6);

        assertThat(command.dice()).containsExactly(1, 2, 3, 4, 5);
        assertThatThrownBy(() -> command.dice().add(6))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void rejectsMissingIdentifiersAndInvalidRound() {
        assertThatThrownBy(() ->
                new ScoreConfirmationCommand("", "player-1", 1, "choice", List.of(1, 2, 3, 4, 5)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() ->
                new ScoreConfirmationCommand("game-1", "", 1, "choice", List.of(1, 2, 3, 4, 5)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() ->
                new ScoreConfirmationCommand("game-1", "player-1", 0, "choice", List.of(1, 2, 3, 4, 5)))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
