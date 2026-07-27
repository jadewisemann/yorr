package com.ssafy.yorr.game.service;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.dto.ScoreConfirmationCommand;
import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.repository.ScoreBoardStore;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.INVALID_CATEGORY;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.INVALID_DICE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ScoreConfirmationServiceTest {

    private final CapturingScoreBoardStore store = new CapturingScoreBoardStore();
    private final ScoreConfirmationService service = new ScoreConfirmationService(store);

    @Test
    void recalculatesScoreOnServerAndReturnsUpdatedScoreboard() {
        store.scoreboard = new ScoreBoard(Map.of("fullHouse", 19), 0, 0, 19);

        ScoreConfirmationResult result = service.confirm(command(
                3,
                "fullHouse",
                List.of(3, 3, 3, 5, 5)
        ));

        assertThat(result.score()).isEqualTo(19);
        assertThat(result.category()).isEqualTo("fullHouse");
        assertThat(result.scoreboard()).isSameAs(store.scoreboard);
        assertThat(store.category).isEqualTo(ScoreCategory.FULL_HOUSE);
        assertThat(store.score).isEqualTo(19);
        assertThat(store.roundNumber).isEqualTo(3);
        assertThat(store.requestSignature).isEqualTo("fullHouse:3,3,3,5,5");
    }

    @Test
    void confirmsSacrificedCategoryAsZero() {
        store.scoreboard = new ScoreBoard(Map.of("yacht", 0), 0, 0, 0);

        ScoreConfirmationResult result = service.confirm(command(
                1,
                "yacht",
                List.of(1, 2, 3, 4, 5)
        ));

        assertThat(result.score()).isZero();
        assertThat(result.scoreboard().categories()).containsEntry("yacht", 0);
    }

    @Test
    void rejectsUnknownCategory() {
        assertThatThrownBy(() -> service.confirm(command(
                1,
                "unknown",
                List.of(1, 2, 3, 4, 5)
        ))).isInstanceOfSatisfying(ScoreConfirmationException.class, exception ->
                assertThat(exception.reason()).isEqualTo(INVALID_CATEGORY)
        );
    }

    @Test
    void rejectsInvalidDice() {
        assertThatThrownBy(() -> service.confirm(command(
                1,
                "choice",
                List.of(1, 2, 3, 4, 7)
        ))).isInstanceOfSatisfying(ScoreConfirmationException.class, exception ->
                assertThat(exception.reason()).isEqualTo(INVALID_DICE)
        );
    }

    @Test
    void rejectsNullDie() {
        assertThatThrownBy(() -> service.confirm(command(
                1,
                "choice",
                java.util.Arrays.asList(1, 2, null, 4, 5)
        ))).isInstanceOfSatisfying(ScoreConfirmationException.class, exception ->
                assertThat(exception.reason()).isEqualTo(INVALID_DICE)
        );
    }

    private static ScoreConfirmationCommand command(
            int roundNumber,
            String category,
            List<Integer> dice
    ) {
        return new ScoreConfirmationCommand(
                "game-1",
                "player-1",
                roundNumber,
                category,
                dice
        );
    }

    private static final class CapturingScoreBoardStore implements ScoreBoardStore {
        private ScoreBoard scoreboard = new ScoreBoard(Map.of(), 0, 0, 0);
        private int roundNumber;
        private ScoreCategory category;
        private int score;
        private String requestSignature;

        @Override
        public ScoreBoard confirmScore(
                String gameId,
                String playerId,
                int roundNumber,
                ScoreCategory category,
                int score,
                String requestSignature
        ) {
            this.roundNumber = roundNumber;
            this.category = category;
            this.score = score;
            this.requestSignature = requestSignature;
            return scoreboard;
        }
    }
}
