package com.ssafy.yorr.ws.dto;

import com.ssafy.yorr.game.domain.ScoreBoard;

public record ScoreUpdatePayload(
        String playerId,
        ScoreBoard scoreboard
) {
}
