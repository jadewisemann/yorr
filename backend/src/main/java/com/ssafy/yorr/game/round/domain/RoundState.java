package com.ssafy.yorr.game.round.domain;

import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public final class RoundState {

    private final int roundNumber;
    private final List<String> participantOrder;
    private final Set<String> participantIds;
    private final Map<String, RoundSubmission> submissions;
    private final int activePlayerIndex;
    private final int activeRollCount;
    private final List<Integer> activeDice;

    private RoundState(
            int roundNumber,
            List<String> participantOrder,
            Map<String, RoundSubmission> submissions,
            int activePlayerIndex,
            int activeRollCount,
            List<Integer> activeDice
    ) {
        this.roundNumber = validateRoundNumber(roundNumber);
        this.participantOrder = List.copyOf(participantOrder);
        this.participantIds = Collections.unmodifiableSet(new LinkedHashSet<>(participantOrder));
        this.submissions = Collections.unmodifiableMap(new LinkedHashMap<>(submissions));
        this.activePlayerIndex = activePlayerIndex;
        this.activeRollCount = activeRollCount;
        this.activeDice = activeDice == null ? null : List.copyOf(activeDice);
    }

    public static RoundState start(int roundNumber, Collection<String> participantIds) {
        return new RoundState(roundNumber, immutableParticipants(participantIds), Map.of(), 0, 0, null);
    }

    public RoundState recordRoll(
            String playerId,
            int submittedRoundNumber,
            int rollCount,
            List<Boolean> held,
            List<Integer> rolledDice
    ) {
        validateCurrentPlayer(playerId, submittedRoundNumber);
        if (rollCount < 1 || rollCount > 3 || rollCount != activeRollCount + 1) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_ROLL,
                    "rollCount must advance exactly once and stay between 1 and 3"
            );
        }
        validateHeld(held);
        validateDice(rolledDice);
        if (activeDice == null && held.stream().anyMatch(Boolean.TRUE::equals)) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_ROLL,
                    "dice cannot be held before the first roll"
            );
        }
        List<Integer> nextDice = new java.util.ArrayList<>(rolledDice);
        if (activeDice != null) {
            for (int index = 0; index < held.size(); index++) {
                if (Boolean.TRUE.equals(held.get(index))) {
                    nextDice.set(index, activeDice.get(index));
                }
            }
        }
        return new RoundState(
                roundNumber,
                participantOrder,
                submissions,
                activePlayerIndex,
                rollCount,
                nextDice
        );
    }

    public RoundSubmissionResult submit(RoundSubmission submission) {
        validateCurrentPlayer(submission.playerId(), submission.roundNumber());
        if (submissions.containsKey(submission.playerId())) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.ALREADY_SUBMITTED,
                    "player already submitted for round " + roundNumber + ": " + submission.playerId()
            );
        }

        Map<String, RoundSubmission> nextSubmissions = new LinkedHashMap<>(submissions);
        nextSubmissions.put(submission.playerId(), submission);
        return advance(nextSubmissions);
    }

    public RoundSubmissionResult expire() {
        return advance(submissions);
    }

    private RoundSubmissionResult advance(Map<String, RoundSubmission> currentSubmissions) {
        if (activePlayerIndex < participantOrder.size() - 1) {
            return new RoundSubmissionResult(
                    new RoundState(
                            roundNumber,
                            participantOrder,
                            currentSubmissions,
                            activePlayerIndex + 1,
                            0,
                            null
                    ),
                    null
            );
        }
        return complete(currentSubmissions);
    }

    private RoundSubmissionResult complete(Map<String, RoundSubmission> completedSubmissions) {
        RoundCompletion completion = new RoundCompletion(
                roundNumber,
                completedSubmissions.keySet().stream().toList(),
                roundNumber + 1
        );
        RoundState nextRoundState = new RoundState(
                roundNumber + 1,
                participantOrder,
                Map.of(),
                0,
                0,
                null
        );
        return new RoundSubmissionResult(nextRoundState, completion);
    }

    public int roundNumber() {
        return roundNumber;
    }

    public Set<String> participantIds() {
        return participantIds;
    }

    public List<String> participantOrder() {
        return participantOrder;
    }

    public String activePlayerId() {
        return participantOrder.get(activePlayerIndex);
    }

    public int activeRollCount() {
        return activeRollCount;
    }

    public List<Integer> activeDice() {
        return activeDice;
    }

    public Map<String, RoundSubmission> submissions() {
        return submissions;
    }

    public Set<String> submittedPlayerIds() {
        return submissions.keySet();
    }

    private void validateCurrentPlayer(String playerId, int submittedRoundNumber) {
        if (submittedRoundNumber != roundNumber) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.ROUND_MISMATCH,
                    "submitted round " + submittedRoundNumber + " does not match current round " + roundNumber
            );
        }
        if (!participantIds.contains(playerId)) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.PLAYER_NOT_IN_ROUND,
                    "player is not participating in the current round: " + playerId
            );
        }
        if (!activePlayerId().equals(playerId)) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.NOT_ACTIVE_PLAYER,
                    "it is not this player's turn: " + playerId
            );
        }
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

    private static List<String> immutableParticipants(Collection<String> participantIds) {
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
        return List.copyOf(copy);
    }

    private static void validateHeld(List<Boolean> held) {
        if (held == null || held.size() != 5 || held.stream().anyMatch(java.util.Objects::isNull)) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_ROLL,
                    "held must contain exactly five boolean values"
            );
        }
    }

    private static void validateDice(List<Integer> dice) {
        if (dice == null || dice.size() != 5
                || dice.stream().anyMatch(value -> value == null || value < 1 || value > 6)) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_DICE,
                    "exactly five dice values between 1 and 6 are required"
            );
        }
    }
}
