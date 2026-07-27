package com.ssafy.yorr.game.service;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.domain.YachtScoreCalculator;
import com.ssafy.yorr.game.dto.ScoreConfirmationCommand;
import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.repository.ScoreBoardStore;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.INVALID_CATEGORY;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.INVALID_DICE;

@Service
public class ScoreConfirmationService {

    private final ScoreBoardStore scoreBoardStore;

    public ScoreConfirmationService(ScoreBoardStore scoreBoardStore) {
        this.scoreBoardStore = scoreBoardStore;
    }

    public ScoreConfirmationResult confirm(ScoreConfirmationCommand command) {
        if (command == null) {
            throw new IllegalArgumentException("점수 확정 명령은 null일 수 없습니다.");
        }

        ScoreCategory category = categoryOf(command.category());
        int[] dice = diceValues(command.dice());
        int score;
        try {
            score = YachtScoreCalculator.calculateScore(category, dice);
        } catch (IllegalArgumentException exception) {
            throw new ScoreConfirmationException(INVALID_DICE, exception.getMessage(), exception);
        }

        ScoreBoard scoreboard = scoreBoardStore.confirmScore(
                command.gameId(),
                command.playerId(),
                command.roundNumber(),
                category,
                score,
                requestSignature(category, command.dice())
        );
        return new ScoreConfirmationResult(
                command.gameId(),
                command.playerId(),
                command.roundNumber(),
                category.apiKey(),
                score,
                scoreboard
        );
    }

    private static ScoreCategory categoryOf(String apiKey) {
        try {
            return ScoreCategory.fromApiKey(apiKey);
        } catch (IllegalArgumentException exception) {
            throw new ScoreConfirmationException(INVALID_CATEGORY, exception.getMessage(), exception);
        }
    }

    private static int[] diceValues(List<Integer> dice) {
        if (dice == null || dice.stream().anyMatch(value -> value == null)) {
            throw new ScoreConfirmationException(INVALID_DICE, "주사위는 null을 포함할 수 없습니다.");
        }
        return dice.stream().mapToInt(Integer::intValue).toArray();
    }

    private static String requestSignature(ScoreCategory category, List<Integer> dice) {
        return category.apiKey() + ":" + dice.stream()
                .map(String::valueOf)
                .collect(Collectors.joining(","));
    }
}
