package com.ssafy.yorr.game.round.infrastructure;

import com.ssafy.yorr.game.round.application.port.RoundStateStore;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.game.round.domain.RoundCompletion;
import com.ssafy.yorr.game.round.domain.RoundSynchronizationException;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Single-application-instance store. A Redis-backed implementation can replace
 * this adapter while keeping {@link RoundStateStore#submitAtomically} atomic.
 */
@Component
public class InMemoryRoundStateStore implements RoundStateStore {

    private final ConcurrentMap<String, RoundState> states = new ConcurrentHashMap<>();

    @Override
    public void initialize(String roomId, RoundState initialState) {
        validateRoomId(roomId);
        if (initialState == null) {
            throw new IllegalArgumentException("initialState must not be null");
        }
        if (states.putIfAbsent(roomId, initialState) != null) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.ROUND_ALREADY_INITIALIZED,
                    "round state already initialized for room: " + roomId
            );
        }
    }

    @Override
    public RoundSubmissionResult submitAtomically(
            String roomId,
            RoundSubmission submission,
            Runnable beforeStateChange
    ) {
        validateRoomId(roomId);
        if (submission == null) {
            throw new IllegalArgumentException("submission must not be null");
        }
        if (beforeStateChange == null) {
            throw new IllegalArgumentException("beforeStateChange must not be null");
        }

        AtomicReference<RoundSubmissionResult> resultHolder = new AtomicReference<>();
        states.compute(roomId, (key, currentState) -> {
            if (currentState == null) {
                throw new RoundSynchronizationException(
                        RoundSynchronizationException.Reason.ROUND_NOT_INITIALIZED,
                        "round state is not initialized for room: " + roomId
                );
            }
            RoundSubmissionResult result = currentState.submit(submission);
            beforeStateChange.run();
            resultHolder.set(result);
            return result.state();
        });
        return resultHolder.get();
    }

    @Override
    public Optional<RoundCompletion> expireAtomically(String roomId, int expectedRoundNumber) {
        validateRoomId(roomId);
        AtomicReference<RoundCompletion> completionHolder = new AtomicReference<>();
        states.computeIfPresent(roomId, (key, currentState) -> {
            if (currentState.roundNumber() != expectedRoundNumber) {
                return currentState;
            }
            RoundSubmissionResult result = currentState.expire();
            completionHolder.set(result.completion().orElseThrow());
            return result.state();
        });
        return Optional.ofNullable(completionHolder.get());
    }

    @Override
    public Optional<RoundState> findByRoomId(String roomId) {
        validateRoomId(roomId);
        return Optional.ofNullable(states.get(roomId));
    }

    @Override
    public boolean remove(String roomId) {
        validateRoomId(roomId);
        return states.remove(roomId) != null;
    }

    private static void validateRoomId(String roomId) {
        if (roomId == null || roomId.isBlank()) {
            throw new IllegalArgumentException("roomId must not be blank");
        }
    }
}
