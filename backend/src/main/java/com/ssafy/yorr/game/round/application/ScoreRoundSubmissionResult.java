package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;

public record ScoreRoundSubmissionResult(
        ScoreConfirmationResult score,
        RoundSubmissionResult round
) {
}
