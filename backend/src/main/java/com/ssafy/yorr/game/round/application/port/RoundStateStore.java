package com.ssafy.yorr.game.round.application.port;

import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;

import java.util.Optional;

public interface RoundStateStore {

    void initialize(String roomId, RoundState initialState);

    /**
     * Applies one submission and stores the returned state as one atomic operation.
     * Implementations must prevent two concurrent final submissions from completing
     * the same round more than once. The callback runs after submission validation
     * and before the state change is committed. If it fails, the current round state
     * must remain unchanged.
     */
    RoundSubmissionResult submitAtomically(
            String roomId,
            RoundSubmission submission,
            Runnable beforeStateChange
    );

    RoundState recordRollAtomically(
            String roomId,
            String playerId,
            int roundNumber,
            int rollCount,
            java.util.List<Boolean> held,
            java.util.List<Integer> rolledDice
    );

    /** Stores the KEEP the active player changed between rolls. */
    RoundState recordHoldAtomically(
            String roomId,
            String playerId,
            int roundNumber,
            java.util.List<Boolean> held
    );

    /**
     * Rolls once on behalf of the active player, but only while the expected turn is
     * still current and it still has rolls left. Returns empty when the turn already
     * moved on or the roll budget is spent — the caller then records a score instead.
     */
    Optional<RoundState> autoRollAtomically(
            String roomId,
            int expectedRoundNumber,
            String expectedActivePlayerId,
            java.util.List<Integer> rolledDice
    );

    /**
     * Completes the round only when it is still the expected current round.
     * Returns empty when the room was removed or another path already advanced it.
     */
    Optional<RoundSubmissionResult> expireAtomically(
            String roomId,
            int expectedRoundNumber,
            String expectedActivePlayerId
    );

    Optional<RoundState> findByRoomId(String roomId);

    boolean remove(String roomId);
}
