package com.ssafy.yorr.game.dto;

import com.ssafy.yorr.game.domain.GameResult;

import java.util.List;

public record GameResultsResponse(
        List<GameRankingResponse> rankings,
        boolean isTie
) {

    public GameResultsResponse {
        rankings = List.copyOf(rankings);
    }

    public static GameResultsResponse from(GameResult result) {
        return new GameResultsResponse(
                result.players().stream().map(GameRankingResponse::from).toList(),
                result.isTie()
        );
    }
}
