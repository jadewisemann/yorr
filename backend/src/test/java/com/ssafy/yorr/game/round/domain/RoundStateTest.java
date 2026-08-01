package com.ssafy.yorr.game.round.domain;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RoundStateTest {

    @Test
    void waitsUntilEveryParticipantSubmits() {
        RoundState state = rolled(RoundState.start(1, List.of("player-a", "player-b")));

        RoundSubmissionResult result = state.submit(submission("player-a", 1));

        assertThat(result.roundCompleted()).isFalse();
        assertThat(result.state().roundNumber()).isEqualTo(1);
        assertThat(result.state().submittedPlayerIds()).containsExactly("player-a");
        assertThat(result.state().activePlayerId()).isEqualTo("player-b");
    }

    @Test
    void advancesAndClearsSubmissionsWhenEveryParticipantSubmits() {
        RoundState state = rolled(RoundState.start(3, List.of("player-a", "player-b")));
        RoundState waiting = state.submit(submission("player-a", 3)).state();
        waiting = rolled(waiting);

        RoundSubmissionResult result = waiting.submit(submission("player-b", 3));

        assertThat(result.roundCompleted()).isTrue();
        assertThat(result.completedRound().roundNumber()).isEqualTo(3);
        assertThat(result.completedRound().nextRoundNumber()).isEqualTo(4);
        assertThat(result.completedRound().submittedPlayerIds()).containsExactly("player-a", "player-b");
        assertThat(result.state().roundNumber()).isEqualTo(4);
        assertThat(result.state().submittedPlayerIds()).isEmpty();
        assertThat(result.state().activePlayerId()).isEqualTo("player-a");
    }

    @Test
    void rejectsSubmissionFromPlayerWhoseTurnHasNotStarted() {
        RoundState waiting = RoundState.start(1, List.of("player-a", "player-b"));

        assertThatThrownBy(() -> waiting.submit(submission("player-b", 1)))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.NOT_ACTIVE_PLAYER)
                );
    }

    @Test
    void recordsEachRollExactlyOnceAndResetsForTheNextPlayer() {
        RoundState state = RoundState.start(1, List.of("player-a", "player-b"));

        RoundState afterFirstRoll = state.recordRoll(
                "player-a", 1, 1, noHeld(), List.of(1, 2, 3, 4, 5));
        RoundState afterSecondRoll = afterFirstRoll.recordRoll(
                "player-a",
                1,
                2,
                List.of(true, false, true, false, true),
                List.of(6, 6, 6, 6, 6)
        );
        RoundState nextPlayer = afterSecondRoll.submit(
                new RoundSubmission("player-a", 1, afterSecondRoll.activeDice(), "smallStraight")
        ).state();

        assertThat(afterFirstRoll.activeRollCount()).isEqualTo(1);
        assertThat(afterSecondRoll.activeRollCount()).isEqualTo(2);
        assertThat(afterSecondRoll.activeDice()).containsExactly(1, 6, 3, 6, 5);
        assertThat(nextPlayer.activePlayerId()).isEqualTo("player-b");
        assertThat(nextPlayer.activeRollCount()).isZero();
    }

    @Test
    void autoRollKeepsTheDiceHeldOnTheLastRollAndConsumesOneRoll() {
        RoundState afterFirstRoll = RoundState.start(1, List.of("player-a"))
                .recordRoll("player-a", 1, 1, noHeld(), List.of(6, 6, 6, 2, 1));
        RoundState afterSecondRoll = afterFirstRoll.recordRoll(
                "player-a",
                1,
                2,
                List.of(true, true, true, false, false),
                List.of(1, 1, 1, 5, 5)
        );

        RoundState autoRolled = afterSecondRoll.autoRoll(List.of(4, 4, 4, 4, 4));

        assertThat(afterSecondRoll.activeHeld()).containsExactly(true, true, true, false, false);
        assertThat(autoRolled.activeRollCount()).isEqualTo(3);
        assertThat(autoRolled.hasRollsLeft()).isFalse();
        // 킵한 6·6·6은 살아남고 나머지 두 칸만 다시 굴렸다.
        assertThat(autoRolled.activeDice()).containsExactly(6, 6, 6, 4, 4);
    }

    @Test
    void autoRollRerollsEverythingWhenThePlayerNeverRolled() {
        RoundState state = RoundState.start(1, List.of("player-a"));

        RoundState autoRolled = state.autoRoll(List.of(3, 3, 3, 3, 3));

        assertThat(autoRolled.activeRollCount()).isEqualTo(1);
        assertThat(autoRolled.activeDice()).containsExactly(3, 3, 3, 3, 3);
        assertThat(autoRolled.activePlayerId()).isEqualTo("player-a");
    }

    @Test
    void rejectsAutoRollWhenTheRollBudgetIsSpent() {
        RoundState state = RoundState.start(1, List.of("player-a"))
                .recordRoll("player-a", 1, 1, noHeld(), List.of(1, 2, 3, 4, 5))
                .recordRoll("player-a", 1, 2, noHeld(), List.of(1, 2, 3, 4, 5))
                .recordRoll("player-a", 1, 3, noHeld(), List.of(1, 2, 3, 4, 5));

        assertThat(state.hasRollsLeft()).isFalse();
        assertThatThrownBy(() -> state.autoRoll(List.of(6, 6, 6, 6, 6)))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.INVALID_ROLL)
                );
    }

    @Test
    void rejectsSkippedOrDuplicateRollCounts() {
        RoundState state = RoundState.start(1, List.of("player-a"));

        assertThatThrownBy(() -> state.recordRoll(
                "player-a", 1, 2, noHeld(), List.of(1, 2, 3, 4, 5)))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.INVALID_ROLL)
                );
    }

    @Test
    void rejectsSubmissionForDifferentRound() {
        RoundState state = RoundState.start(2, List.of("player-a"));

        assertThatThrownBy(() -> state.submit(submission("player-a", 1)))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.ROUND_MISMATCH)
                );
    }

    @Test
    void rejectsSubmissionFromNonParticipant() {
        RoundState state = RoundState.start(1, List.of("player-a"));

        assertThatThrownBy(() -> state.submit(submission("intruder", 1)))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.PLAYER_NOT_IN_ROUND)
                );
    }

    @Test
    void rejectsSubmissionBeforeThePlayerRolls() {
        RoundState state = RoundState.start(1, List.of("player-a"));

        assertThatThrownBy(() -> state.submit(submission("player-a", 1)))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.INVALID_DICE)
                );
    }

    @Test
    void rejectsDiceThatDoNotMatchTheServerRoll() {
        RoundState state = RoundState.start(1, List.of("player-a"))
                .recordRoll("player-a", 1, 1, noHeld(), List.of(1, 2, 3, 4, 6));

        assertThatThrownBy(() -> state.submit(
                new RoundSubmission("player-a", 1, List.of(6, 6, 6, 6, 6), "yacht")
        )).isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                assertThat(exception.reason())
                        .isEqualTo(RoundSynchronizationException.Reason.INVALID_DICE)
        );
    }

    @Test
    void rejectsDuplicateParticipants() {
        assertThatThrownBy(() -> RoundState.start(1, List.of("player-a", "player-a")))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.INVALID_PLAYER)
                );
    }

    /**
     * 마지막 라운드의 마지막 제출은 다음 라운드를 만들지 않는다.
     * 여기서 멈추지 않으면 라운드가 13, 14…로 무한히 증가한다(게임이 종료되지 않던 원인).
     */
    @Test
    void marksTheGameCompletedInsteadOfOpeningAnotherRound() {
        RoundState state = rolled(RoundState.start(2, List.of("player-a"), 2));

        RoundSubmissionResult result = state.submit(submission("player-a", 2));

        assertThat(result.completion()).hasValueSatisfying(completion -> {
            assertThat(completion.gameCompleted()).isTrue();
            assertThat(completion.roundNumber()).isEqualTo(2);
            assertThat(completion.nextRoundNumber()).isEqualTo(2);
        });
        assertThat(result.state().isFinished()).isTrue();
        assertThat(result.state().roundNumber()).isEqualTo(2);
    }

    @Test
    void keepsOpeningRoundsUntilTheLastOne() {
        RoundState state = rolled(RoundState.start(1, List.of("player-a"), 2));

        RoundSubmissionResult result = state.submit(submission("player-a", 1));

        assertThat(result.completion()).hasValueSatisfying(completion ->
                assertThat(completion.gameCompleted()).isFalse()
        );
        assertThat(result.state().isFinished()).isFalse();
        assertThat(result.state().roundNumber()).isEqualTo(2);
    }

    /** 종료 후 도착한 제출·굴림은 거부한다. 받아주면 끝난 게임의 점수판이 다시 바뀐다. */
    @Test
    void rejectsEverythingOnceTheGameIsFinished() {
        RoundState finished = RoundState.start(1, List.of("player-a"), 1)
                .recordRoll("player-a", 1, 1, noHeld(), List.of(1, 2, 3, 4, 5))
                .submit(submission("player-a", 1))
                .state();

        assertThatThrownBy(() -> finished.submit(submission("player-a", 1)))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.GAME_ALREADY_FINISHED)
                );
        assertThatThrownBy(() -> finished.recordRoll("player-a", 1, 1, noHeld(), List.of(1, 2, 3, 4, 5)))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.GAME_ALREADY_FINISHED)
                );
        assertThatThrownBy(finished::expire)
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.GAME_ALREADY_FINISHED)
                );
    }

    private static RoundSubmission submission(String playerId, int roundNumber) {
        return new RoundSubmission(playerId, roundNumber, List.of(1, 2, 3, 4, 5), "smallStraight");
    }

    private static List<Boolean> noHeld() {
        return List.of(false, false, false, false, false);
    }

    private static RoundState rolled(RoundState state) {
        return state.recordRoll(
                state.activePlayerId(), state.roundNumber(), 1, noHeld(), List.of(1, 2, 3, 4, 5));
    }
}
