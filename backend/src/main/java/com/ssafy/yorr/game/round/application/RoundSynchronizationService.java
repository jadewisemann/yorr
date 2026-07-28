package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.application.port.RoundStateStore;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.game.round.domain.RoundCompletion;
import com.ssafy.yorr.game.round.domain.RoundSynchronizationException;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.Optional;

@Service
public class RoundSynchronizationService {

    private final RoundStateStore roundStateStore;

    public RoundSynchronizationService(RoundStateStore roundStateStore) {
        this.roundStateStore = roundStateStore;
    }

    public RoundState initialize(String roomId, int roundNumber, Collection<String> participantIds) {
        RoundState initialState = RoundState.start(roundNumber, participantIds);
        roundStateStore.initialize(roomId, initialState);
        return initialState;
    }

    public RoundSubmissionResult submit(String roomId, String playerId, RoundSubmitPayload payload) {
        return submit(roomId, playerId, payload, () -> {});
    }

    public RoundSubmissionResult submit(
            String roomId,
            String playerId,
            RoundSubmitPayload payload,
            Runnable beforeStateChange
    ) {
        if (payload == null) {
            throw new IllegalArgumentException("payload must not be null");
        }
        if (beforeStateChange == null) {
            throw new IllegalArgumentException("beforeStateChange must not be null");
        }
        RoundSubmission submission = new RoundSubmission(
                playerId,
                payload.roundNumber(),
                payload.dice(),
                payload.category()
        );
        return roundStateStore.submitAtomically(roomId, submission, beforeStateChange);
    }

    public Optional<RoundSubmissionResult> expire(
            String roomId,
            int expectedRoundNumber,
            String expectedActivePlayerId
    ) {
        return roundStateStore.expireAtomically(roomId, expectedRoundNumber, expectedActivePlayerId);
    }

    public RoundState recordRoll(String roomId, String playerId, DiceRollPayload payload) {
        if (payload == null || payload.dice() == null || payload.dice().size() != 5
                || payload.dice().stream().anyMatch(value -> value == null || value < 1 || value > 6)) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_DICE,
                    "exactly five dice values between 1 and 6 are required"
            );
        }
        return roundStateStore.recordRollAtomically(
                roomId,
                playerId,
                payload.roundNumber(),
                payload.rollCount()
        );
    }

    public boolean remove(String roomId) {
        return roundStateStore.remove(roomId);
    }
}
