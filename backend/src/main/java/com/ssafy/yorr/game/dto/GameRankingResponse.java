package com.ssafy.yorr.game.dto;

import com.ssafy.yorr.game.domain.PlayerResult;

public record GameRankingResponse(
        int rank,
        String playerId,
        int total
) {

    public static GameRankingResponse from(PlayerResult result) {
        return new GameRankingResponse(result.rank(), result.playerId(), result.finalScore());
    }
}
