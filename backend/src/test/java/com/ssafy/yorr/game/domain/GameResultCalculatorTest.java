package com.ssafy.yorr.game.domain;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GameResultCalculatorTest {

    @Test
    void determinesWinnerBetweenTwoPlayers() {
        GameResult result = GameResultCalculator.calculate(List.of(
                score("player-b", 120),
                score("player-a", 180)
        ));

        assertThat(result.players()).containsExactly(
                playerResult("player-a", 180, 1, true, false),
                playerResult("player-b", 120, 2, false, false)
        );
        assertThat(result.isTie()).isFalse();
    }

    @Test
    void ranksMultiplePlayersByDescendingScore() {
        GameResult result = GameResultCalculator.calculate(List.of(
                score("player-c", 90),
                score("player-a", 210),
                score("player-b", 150),
                score("player-d", 30)
        ));

        assertThat(result.players()).extracting(PlayerResult::playerId)
                .containsExactly("player-a", "player-b", "player-c", "player-d");
        assertThat(result.players()).extracting(PlayerResult::rank)
                .containsExactly(1, 2, 3, 4);
    }

    @Test
    void producesSameResultRegardlessOfInputOrder() {
        List<PlayerFinalScore> firstOrder = List.of(
                score("player-a", 100),
                score("player-b", 200),
                score("player-c", 150)
        );
        List<PlayerFinalScore> secondOrder = List.of(
                score("player-c", 150),
                score("player-a", 100),
                score("player-b", 200)
        );

        assertThat(GameResultCalculator.calculate(firstOrder))
                .isEqualTo(GameResultCalculator.calculate(secondOrder));
    }

    @Test
    void treatsHighestScoreTieAsJointWinners() {
        GameResult result = GameResultCalculator.calculate(List.of(
                score("player-b", 200),
                score("player-c", 100),
                score("player-a", 200)
        ));

        assertThat(result.players()).containsExactly(
                playerResult("player-a", 200, 1, true, true),
                playerResult("player-b", 200, 1, true, true),
                playerResult("player-c", 100, 3, false, false)
        );
        assertThat(result.isTie()).isTrue();
    }

    @Test
    void appliesCompetitionRankingToMiddleScoreTieWithoutGameTie() {
        GameResult result = GameResultCalculator.calculate(List.of(
                score("player-d", 100),
                score("player-c", 150),
                score("player-a", 200),
                score("player-b", 150)
        ));

        assertThat(result.players()).containsExactly(
                playerResult("player-a", 200, 1, true, false),
                playerResult("player-b", 150, 2, false, true),
                playerResult("player-c", 150, 2, false, true),
                playerResult("player-d", 100, 4, false, false)
        );
        assertThat(result.isTie()).isFalse();
    }

    @Test
    void treatsEveryPlayerAsJointWinnerWhenAllScoresTie() {
        GameResult result = GameResultCalculator.calculate(List.of(
                score("player-c", 120),
                score("player-a", 120),
                score("player-b", 120)
        ));

        assertThat(result.players()).containsExactly(
                playerResult("player-a", 120, 1, true, true),
                playerResult("player-b", 120, 1, true, true),
                playerResult("player-c", 120, 1, true, true)
        );
        assertThat(result.isTie()).isTrue();
    }

    @Test
    void treatsSinglePlayerAsSoleWinnerWithoutTie() {
        GameResult result = GameResultCalculator.calculate(List.of(score("solo", 0)));

        assertThat(result.players()).containsExactly(
                playerResult("solo", 0, 1, true, false)
        );
        assertThat(result.isTie()).isFalse();
    }

    @Test
    void ordersEqualScoresByPlayerId() {
        GameResult result = GameResultCalculator.calculate(List.of(
                score("charlie", 50),
                score("alpha", 50),
                score("bravo", 50)
        ));

        assertThat(result.players()).extracting(PlayerResult::playerId)
                .containsExactly("alpha", "bravo", "charlie");
    }

    @Test
    void rejectsNullOrEmptyPlayerList() {
        assertThatThrownBy(() -> GameResultCalculator.calculate(null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> GameResultCalculator.calculate(List.of()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsNullPlayer() {
        List<PlayerFinalScore> scores = new ArrayList<>();
        scores.add(score("player-a", 100));
        scores.add(null);

        assertThatThrownBy(() -> GameResultCalculator.calculate(scores))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsNullOrBlankPlayerId() {
        assertThatThrownBy(() -> GameResultCalculator.calculate(List.of(score(null, 100))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> GameResultCalculator.calculate(List.of(score("", 100))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> GameResultCalculator.calculate(List.of(score("   ", 100))))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsNullOrNegativeFinalScore() {
        assertThatThrownBy(() -> GameResultCalculator.calculate(List.of(score("player-a", null))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> GameResultCalculator.calculate(List.of(score("player-a", -1))))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsDuplicatePlayerId() {
        assertThatThrownBy(() -> GameResultCalculator.calculate(List.of(
                score("player-a", 100),
                score("player-a", 200)
        ))).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void doesNotModifyInputCollection() {
        List<PlayerFinalScore> scores = new ArrayList<>(List.of(
                score("player-b", 100),
                score("player-a", 200)
        ));
        List<PlayerFinalScore> original = List.copyOf(scores);

        GameResultCalculator.calculate(scores);

        assertThat(scores).containsExactlyElementsOf(original);
    }

    @Test
    void returnsUnmodifiablePlayerResults() {
        GameResult result = GameResultCalculator.calculate(List.of(score("player-a", 100)));

        assertThatThrownBy(() -> result.players().add(
                playerResult("player-b", 50, 2, false, false)
        )).isInstanceOf(UnsupportedOperationException.class);
    }

    private static PlayerFinalScore score(String playerId, Integer finalScore) {
        return new PlayerFinalScore(playerId, finalScore);
    }

    private static PlayerResult playerResult(
            String playerId,
            int finalScore,
            int rank,
            boolean winner,
            boolean tied
    ) {
        return new PlayerResult(playerId, finalScore, rank, winner, tied);
    }
}
