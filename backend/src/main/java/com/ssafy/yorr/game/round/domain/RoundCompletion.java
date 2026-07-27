package com.ssafy.yorr.game.round.domain;

import java.util.List;

public record RoundCompletion(
        int roundNumber,
        List<String> submittedPlayerIds,
        int nextRoundNumber
) {

    public RoundCompletion {
        submittedPlayerIds = List.copyOf(submittedPlayerIds);
    }
}
