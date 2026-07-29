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
    /** 요트 정규룰 족보 수 = 한 게임의 라운드 수. 참가자가 이 횟수만큼 기록하면 점수판이 꽉 찬다. */
    public static final int DEFAULT_TOTAL_ROUNDS = 12;

    private final int roundNumber;
    private final int totalRounds;
    private final List<String> participantOrder;
    private final Set<String> participantIds;
    private final Map<String, RoundSubmission> submissions;
    private final int activePlayerIndex;
    private final int activeRollCount;
    private final List<Integer> activeDice;
    private final List<Boolean> activeHeld;
    /** 마지막 라운드까지 끝난 터미널 상태. 굴림·제출을 모두 거부한다. */
    private final boolean finished;

    private RoundState(
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
        this.roundNumber = validateRoundNumber(roundNumber);
        this.totalRounds = validateTotalRounds(totalRounds, roundNumber);
        this.participantOrder = List.copyOf(participantOrder);
        this.participantIds = Collections.unmodifiableSet(new LinkedHashSet<>(participantOrder));
        this.submissions = Collections.unmodifiableMap(new LinkedHashMap<>(submissions));
        this.activePlayerIndex = activePlayerIndex;
        this.activeRollCount = activeRollCount;
        this.activeDice = activeDice == null ? null : List.copyOf(activeDice);
        this.activeHeld = activeHeld == null ? null : List.copyOf(activeHeld);
        this.finished = finished;
    }

    public static RoundState start(int roundNumber, Collection<String> participantIds) {
        return start(roundNumber, participantIds, DEFAULT_TOTAL_ROUNDS);
    }

    public static RoundState start(int roundNumber, Collection<String> participantIds, int totalRounds) {
        return new RoundState(
                roundNumber,
                totalRounds,
                immutableParticipants(participantIds),
                Map.of(),
                0,
                0,
                null,
                null,
                false
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
                totalRounds,
                participantOrder,
                submissions,
                activePlayerIndex,
                rollCount,
                nextDice,
                held,
                false
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
        if (finished) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.GAME_ALREADY_FINISHED,
                    "이미 종료된 게임은 만료 진행할 수 없습니다: round " + roundNumber
            );
        }
        return advance(submissions);
    }

    private RoundSubmissionResult advance(Map<String, RoundSubmission> currentSubmissions) {
        if (activePlayerIndex < participantOrder.size() - 1) {
            return new RoundSubmissionResult(
                    new RoundState(
                            roundNumber,
                            totalRounds,
                            participantOrder,
                            currentSubmissions,
                            activePlayerIndex + 1,
                            0,
                            null,
                            null,
                            false
                    ),
                    null
            );
        }
        return complete(currentSubmissions);
    }

    /**
     * 마지막 참가자의 턴이 끝났다. 라운드 상한에 닿았으면 다음 라운드를 만들지 않고
     * 터미널 상태로 전이한다 — 여기서 멈추지 않으면 라운드가 무한히 증가한다.
     */
    private RoundSubmissionResult complete(Map<String, RoundSubmission> completedSubmissions) {
        boolean gameCompleted = roundNumber >= totalRounds;
        RoundCompletion completion = new RoundCompletion(
                roundNumber,
                completedSubmissions.keySet().stream().toList(),
                gameCompleted ? roundNumber : roundNumber + 1,
                gameCompleted
        );
        RoundState nextRoundState = gameCompleted
                ? new RoundState(
                        roundNumber,
                        totalRounds,
                        participantOrder,
                        completedSubmissions,
                        activePlayerIndex,
                        0,
                        null,
                        null,
                        true
                )
                : new RoundState(
                        roundNumber + 1,
                        totalRounds,
                        participantOrder,
                        Map.of(),
                        0,
                        0,
                        null,
                        null,
                        false
                );
        return new RoundSubmissionResult(nextRoundState, completion);
    }

    public int roundNumber() {
        return roundNumber;
    }

    public int totalRounds() {
        return totalRounds;
    }

    /** 마지막 라운드까지 끝났는지. true면 새 턴 타이머를 걸지 않는다. */
    public boolean isFinished() {
        return finished;
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
        // 종료 판정보다 늦게 도착한 굴림·제출. 라운드 번호가 우연히 맞아도 받지 않는다.
        if (finished) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.GAME_ALREADY_FINISHED,
                    "이미 종료된 게임입니다: round " + roundNumber + "/" + totalRounds
            );
        }
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

    private static int validateTotalRounds(int totalRounds, int roundNumber) {
        if (totalRounds < 1) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_ROUND,
                    "totalRounds must be at least 1"
            );
        }
        if (roundNumber > totalRounds) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.INVALID_ROUND,
                    "roundNumber must not exceed totalRounds: " + roundNumber + " > " + totalRounds
            );
        }
        return totalRounds;
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
