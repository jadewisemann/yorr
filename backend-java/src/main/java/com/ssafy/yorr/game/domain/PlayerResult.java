package com.ssafy.yorr.game.domain;

public record PlayerResult(
        String playerId,
        int finalScore,
        int rank,
        boolean winner,
        boolean tied
) {
}
