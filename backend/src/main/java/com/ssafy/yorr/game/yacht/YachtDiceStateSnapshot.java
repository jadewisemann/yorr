package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;

import java.util.List;
import java.util.Map;

public record YachtDiceStateSnapshot(
        int roundNumber,
        int totalRounds,
        List<String> participantOrder,
        Map<String, RoundSubmission> submissions,
        int activePlayerIndex,
        int activeRollCount,
        List<Integer> activeDice,
        List<Boolean> activeHeld,
        boolean finished
) {
    public static YachtDiceStateSnapshot from(RoundState state) {
        return new YachtDiceStateSnapshot(
                state.roundNumber(),
                state.totalRounds(),
                state.participantOrder(),
                state.submissions(),
                state.activePlayerIndex(),
                state.activeRollCount(),
                state.activeDice(),
                state.activeHeld(),
                state.isFinished()
        );
    }

    public RoundState toDomain() {
        return RoundState.restore(
                roundNumber,
                totalRounds,
                participantOrder,
                submissions,
                activePlayerIndex,
                activeRollCount,
                activeDice,
                activeHeld,
                finished
        );
    }
}
