package com.ssafy.yorr.game.dto;

import com.ssafy.yorr.game.domain.ScoreBoard;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public record ScoreBoardResponse(
        Map<String, Integer> categories,
        int upperSubtotal,
        int upperBonus,
        int total
) {

    public ScoreBoardResponse {
        categories = Collections.unmodifiableMap(new LinkedHashMap<>(categories));
    }

    public static ScoreBoardResponse from(ScoreBoard scoreBoard) {
        return new ScoreBoardResponse(
                scoreBoard.categories(),
                scoreBoard.upperSubtotal(),
                scoreBoard.upperBonus(),
                scoreBoard.total()
        );
    }
}
