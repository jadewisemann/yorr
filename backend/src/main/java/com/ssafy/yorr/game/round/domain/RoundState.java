package com.ssafy.yorr.game.round.domain;

import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public final class RoundState {

    private final int roundNumber;
    private final Set<String> participantIds;
    private final Map<String, RoundSubmission> submissions;

    private RoundState(
            int roundNumber,
            Collection<String> participantIds,
            Map<String, RoundSubmission> submissions
    ) {
        this.roundNumber = validateRoundNumber(roundNumber);
        this.participantIds = immutableParticipants(participantIds);
        this.submissions = Collections.unmodifiableMap(new LinkedHashMap<>(submissions));
    }

    public static RoundState start(int roundNumber, Collection<String> participantIds) {
        return new RoundState(roundNumber, participantIds, Map.of());
    }

    public RoundSubmissionResult submit(RoundSubmission submission) {
        if (submission.roundNumber() != roundNumber) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.ROUND_MISMATCH,
                    "submitted round " + submission.roundNumber() + " does not match current round " + roundNumber
            );
        }
        if (!participantIds.contains(submission.playerId())) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.PLAYER_NOT_IN_ROUND,
                    "player is not participating in the current round: " + submission.playerId()
            );
        }
        if (submissions.containsKey(submission.playerId())) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.ALREADY_SUBMITTED,
                    "player already submitted for round " + roundNumber + ": " + submission.playerId()
            );
        }

        Map<String, RoundSubmission> nextSubmissions = new LinkedHashMap<>(submissions);
        nextSubmissions.put(submission.playerId(), submission);

        if (nextSubmissions.size() < participantIds.size()) {
            RoundState waitingState = new RoundState(roundNumber, participantIds, nextSubmissions);
            return new RoundSubmissionResult(waitingState, null);
        }

        return complete(nextSubmissions);
    }

    public RoundSubmissionResult expire() {
        return complete(submissions);
    }

    private RoundSubmissionResult complete(Map<String, RoundSubmission> completedSubmissions) {
        RoundCompletion completion = new RoundCompletion(
                roundNumber,
                completedSubmissions.keySet().stream().toList(),
                roundNumber + 1
        );
        RoundState nextRoundState = new RoundState(roundNumber + 1, participantIds, Map.of());
        return new RoundSubmissionResult(nextRoundState, completion);
    }

    public int roundNumber() {
        return roundNumber;
    }

    public Set<String> participantIds() {
        return participantIds;
    }

    public Map<String, RoundSubmission> submissions() {
        return submissions;
    }

    public Set<String> submittedPlayerIds() {
        return submissions.keySet();
    }

    private static int validateRoundNumber(int roundNumber) {
        if (roundNumber < 1) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_ROUND,
                    "roundNumber must be at least 1"
            );
        }
        return roundNumber;
    }

    private static Set<String> immutableParticipants(Collection<String> participantIds) {
        if (participantIds == null || participantIds.isEmpty()) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_PLAYER,
                    "at least one participant is required"
            );
        }

        LinkedHashSet<String> copy = new LinkedHashSet<>();
        for (String playerId : participantIds) {
            if (playerId == null || playerId.isBlank()) {
                throw new RoundSynchronizationException(
                        RoundSynchronizationException.Reason.INVALID_PLAYER,
                        "participant playerId must not be blank"
                );
            }
            if (!copy.add(playerId)) {
                throw new RoundSynchronizationException(
                        RoundSynchronizationException.Reason.INVALID_PLAYER,
                        "duplicate participant playerId: " + playerId
                );
            }
        }
        return Collections.unmodifiableSet(copy);
    }
}
