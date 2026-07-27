package com.ssafy.yorr.game.dto;

import com.ssafy.yorr.game.domain.ScoreBoard;

public record ScoreConfirmationResult(
        String gameId,
        String playerId,
        int roundNumber,
        String category,
        int score,
        ScoreBoard scoreboard
) {
}
