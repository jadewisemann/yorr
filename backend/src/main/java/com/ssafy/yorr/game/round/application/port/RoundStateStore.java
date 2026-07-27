package com.ssafy.yorr.game.round.application.port;

import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.game.round.domain.RoundCompletion;

import java.util.Optional;

public interface RoundStateStore {

    void initialize(String roomId, RoundState initialState);

    /**
     * Applies one submission and stores the returned state as one atomic operation.
     * Implementations must prevent two concurrent final submissions from completing
     * the same round more than once.
     */
    RoundSubmissionResult submitAtomically(String roomId, RoundSubmission submission);

    /**
     * Completes the round only when it is still the expected current round.
     * Returns empty when the room was removed or another path already advanced it.
     */
    Optional<RoundCompletion> expireAtomically(String roomId, int expectedRoundNumber);

    Optional<RoundState> findByRoomId(String roomId);

    boolean remove(String roomId);
}
