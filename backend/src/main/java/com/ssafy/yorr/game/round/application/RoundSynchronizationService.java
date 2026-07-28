package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.application.port.RoundStateStore;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.game.round.domain.RoundCompletion;
import com.ssafy.yorr.game.round.domain.RoundSynchronizationException;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.IntSupplier;

@Service
public class RoundSynchronizationService {

    private final RoundStateStore roundStateStore;
    private final IntSupplier dieRoller;

    @Autowired
    public RoundSynchronizationService(RoundStateStore roundStateStore) {
        this(roundStateStore, () -> ThreadLocalRandom.current().nextInt(1, 7));
    }

    RoundSynchronizationService(RoundStateStore roundStateStore, IntSupplier dieRoller) {
        this.roundStateStore = roundStateStore;
        this.dieRoller = dieRoller;
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
        if (payload == null) {
            throw new IllegalArgumentException("payload must not be null");
        }
        List<Integer> rolledDice = java.util.stream.IntStream.range(0, 5)
                .map(ignored -> dieRoller.getAsInt())
                .boxed()
                .toList();
        return roundStateStore.recordRollAtomically(
                roomId,
                playerId,
                payload.roundNumber(),
                payload.rollCount(),
                payload.held(),
                rolledDice
        );
    }

    public boolean remove(String roomId) {
        return roundStateStore.remove(roomId);
    }
}
