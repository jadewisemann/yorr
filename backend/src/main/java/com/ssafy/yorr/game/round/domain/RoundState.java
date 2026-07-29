package com.ssafy.yorr.game.round.domain;

import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public final class RoundState {

    /** 한 턴에 허용되는 굴림 횟수. 이 수에 도달하면 남은 굴림이 없다. */
    public static final int MAX_ROLL_COUNT = 3;

    private final int roundNumber;
    private final List<String> participantOrder;
    private final Set<String> participantIds;
    private final Map<String, RoundSubmission> submissions;
    private final int activePlayerIndex;
    private final int activeRollCount;
    private final List<Integer> activeDice;
    private final List<Boolean> activeHeld;

    private RoundState(
            int roundNumber,
            List<String> participantOrder,
            Map<String, RoundSubmission> submissions,
            int activePlayerIndex,
            int activeRollCount,
            List<Integer> activeDice,
            List<Boolean> activeHeld
    ) {
        this.roundNumber = validateRoundNumber(roundNumber);
        this.participantOrder = List.copyOf(participantOrder);
        this.participantIds = Collections.unmodifiableSet(new LinkedHashSet<>(participantOrder));
        this.submissions = Collections.unmodifiableMap(new LinkedHashMap<>(submissions));
        this.activePlayerIndex = activePlayerIndex;
        this.activeRollCount = activeRollCount;
        this.activeDice = activeDice == null ? null : List.copyOf(activeDice);
        this.activeHeld = activeHeld == null ? null : List.copyOf(activeHeld);
    }

    public static RoundState start(int roundNumber, Collection<String> participantIds) {
        return new RoundState(
                roundNumber,
                immutableParticipants(participantIds),
                Map.of(),
                0,
                0,
                null,
                null
        );
    }

    public RoundState recordRoll(
            String playerId,
            int submittedRoundNumber,
            int rollCount,
            List<Boolean> held,
            List<Integer> rolledDice
    ) {
        validateCurrentPlayer(playerId, submittedRoundNumber);
        if (rollCount < 1 || rollCount > MAX_ROLL_COUNT || rollCount != activeRollCount + 1) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_ROLL,
                    "rollCount must advance exactly once and stay between 1 and " + MAX_ROLL_COUNT
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
                nextDice,
                held
        );
    }

    /**
     * 마감 시각이 지났을 때 서버가 현재 턴 소유자를 대신해 한 번 굴린다.
     * <p>
     * 마지막 굴림에 쓰인 KEEP({@link #activeHeld()})을 그대로 유지해 플레이어가 모아둔 족보를
     * 날리지 않는다. 굴림이 남지 않은 턴은 이 메서드로 진행할 수 없다 — 호출자가 먼저
     * {@link #hasRollsLeft()}로 확인하고 없으면 점수 기록으로 넘어가야 한다.
     */
    public RoundState autoRoll(List<Integer> rolledDice) {
        if (!hasRollsLeft()) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_ROLL,
                    "no rolls left to auto roll for round " + roundNumber
            );
        }
        return recordRoll(
                activePlayerId(),
                roundNumber,
                activeRollCount + 1,
                activeHeld == null ? NO_HELD : activeHeld,
                rolledDice
        );
    }

    public boolean hasRollsLeft() {
        return activeRollCount < MAX_ROLL_COUNT;
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
                            null,
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
                null,
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

    /** 마지막 굴림에 쓰인 KEEP. 첫 굴림 전에는 null. */
    public List<Boolean> activeHeld() {
        return activeHeld;
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

    private static final List<Boolean> NO_HELD = List.of(false, false, false, false, false);

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
