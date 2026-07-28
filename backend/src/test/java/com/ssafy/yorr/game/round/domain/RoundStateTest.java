package com.ssafy.yorr.game.round.domain;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RoundStateTest {

    @Test
    void waitsUntilEveryParticipantSubmits() {
        RoundState state = RoundState.start(1, List.of("player-a", "player-b"));

        RoundSubmissionResult result = state.submit(submission("player-a", 1));

        assertThat(result.roundCompleted()).isFalse();
        assertThat(result.state().roundNumber()).isEqualTo(1);
        assertThat(result.state().submittedPlayerIds()).containsExactly("player-a");
        assertThat(result.state().activePlayerId()).isEqualTo("player-b");
    }

    @Test
    void advancesAndClearsSubmissionsWhenEveryParticipantSubmits() {
        RoundState state = RoundState.start(3, List.of("player-a", "player-b"));
        RoundState waiting = state.submit(submission("player-a", 3)).state();

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

        RoundState afterFirstRoll = state.recordRoll("player-a", 1, 1);
        RoundState afterSecondRoll = afterFirstRoll.recordRoll("player-a", 1, 2);
        RoundState nextPlayer = afterSecondRoll.submit(submission("player-a", 1)).state();

        assertThat(afterFirstRoll.activeRollCount()).isEqualTo(1);
        assertThat(afterSecondRoll.activeRollCount()).isEqualTo(2);
        assertThat(nextPlayer.activePlayerId()).isEqualTo("player-b");
        assertThat(nextPlayer.activeRollCount()).isZero();
    }

    @Test
    void rejectsSkippedOrDuplicateRollCounts() {
        RoundState state = RoundState.start(1, List.of("player-a"));

        assertThatThrownBy(() -> state.recordRoll("player-a", 1, 2))
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
    void rejectsDuplicateParticipants() {
        assertThatThrownBy(() -> RoundState.start(1, List.of("player-a", "player-a")))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.INVALID_PLAYER)
                );
    }

    private static RoundSubmission submission(String playerId, int roundNumber) {
        return new RoundSubmission(playerId, roundNumber, List.of(1, 2, 3, 4, 5), "smallStraight");
    }
}
