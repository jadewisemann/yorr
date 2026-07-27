package com.ssafy.yorr.game.round.domain;

import java.util.Optional;

public record RoundSubmissionResult(
        RoundState state,
        RoundCompletion completedRound
) {

    public boolean roundCompleted() {
        return completedRound != null;
    }

    public Optional<RoundCompletion> completion() {
        return Optional.ofNullable(completedRound);
    }
}
