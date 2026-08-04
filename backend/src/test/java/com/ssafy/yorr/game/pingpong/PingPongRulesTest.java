package com.ssafy.yorr.game.pingpong;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class PingPongRulesTest {

    private static final String P1 = "player-1";
    private static final String P2 = "player-2";

    @Test
    void exactTimingReturnsASmashAndDuplicateInputIsIgnored() {
        PingPongState initial = PingPongRules.initial(List.of(P1, P2), 1_000);
        PingPongState served = PingPongRules.serve(initial, 4_000, 0.7);

        PingPongState smashed = PingPongRules.swing(served, P1, 1, 4_900, 0.3);
        PingPongState duplicate = PingPongRules.swing(smashed, P1, 1, 4_901, 0.4);

        assertThat(smashed.ball().direction()).isEqualTo(-1);
        assertThat(smashed.ball().smash()).isTrue();
        assertThat(smashed.rally()).isEqualTo(1);
        assertThat(smashed.lastEvent().type()).isEqualTo(PingPongState.EventType.SMASH);
        assertThat(duplicate).isEqualTo(smashed);
    }

    @Test
    void missingTheBallAwardsTheOpponentWithoutChangingServeAfterOnePoint() {
        PingPongState initial = PingPongRules.initial(List.of(P1, P2), 1_000);
        PingPongState served = PingPongRules.serve(initial, 4_000, 0.7);

        PingPongState point = PingPongRules.expire(served, served.nextActionAt());

        assertThat(point.phase()).isEqualTo(PingPongState.Phase.COUNTDOWN);
        assertThat(point.scores()).containsEntry(P2, 1).containsEntry(P1, 0);
        assertThat(point.serveReceiverId()).isEqualTo(P1);
        assertThat(point.lastEvent().type()).isEqualTo(PingPongState.EventType.POINT);
    }

    @Test
    void serveChangesEveryTwoPointsAndEveryPointAfterDeuce() {
        List<String> players = List.of(P1, P2);

        assertThat(PingPongRules.serveReceiver(players, Map.of(P1, 0, P2, 0))).isEqualTo(P1);
        assertThat(PingPongRules.serveReceiver(players, Map.of(P1, 0, P2, 1))).isEqualTo(P1);
        assertThat(PingPongRules.serveReceiver(players, Map.of(P1, 1, P2, 1))).isEqualTo(P2);
        assertThat(PingPongRules.serveReceiver(players, Map.of(P1, 10, P2, 10))).isEqualTo(P1);
        assertThat(PingPongRules.serveReceiver(players, Map.of(P1, 11, P2, 10))).isEqualTo(P2);
        assertThat(PingPongRules.serveReceiver(players, Map.of(P1, 11, P2, 11))).isEqualTo(P1);
    }

    @Test
    void deuceRequiresAWinningMarginOfTwo() {
        PingPongState deuce = playingAtScore(10, 10);
        PingPongState advantage = PingPongRules.expire(deuce, deuce.nextActionAt());

        assertThat(advantage.phase()).isEqualTo(PingPongState.Phase.COUNTDOWN);
        assertThat(advantage.scores()).containsEntry(P2, 11);

        PingPongState matchPoint = playingAtScore(10, 11);
        PingPongState finished = PingPongRules.expire(matchPoint, matchPoint.nextActionAt());

        assertThat(finished.phase()).isEqualTo(PingPongState.Phase.FINISHED);
        assertThat(finished.scores()).containsEntry(P2, 12);
    }

    @Test
    void leavingPlayerForfeitsTheMatch() {
        PingPongState state = PingPongRules.initial(List.of(P1, P2), 1_000);

        PingPongState finished = PingPongRules.forfeit(state, P1, 2_000);

        assertThat(finished.finished()).isTrue();
        assertThat(finished.scores()).containsEntry(P2, PingPongRules.WIN_SCORE);
        assertThat(finished.lastEvent().type()).isEqualTo(PingPongState.EventType.OPPONENT_LEFT);
    }

    private PingPongState playingAtScore(int p1, int p2) {
        return new PingPongState(
                1,
                PingPongState.Phase.PLAYING,
                List.of(P1, P2),
                Map.of(P1, p1, P2, p2),
                Map.of(P1, -1L, P2, -1L),
                new PingPongState.Ball(0, 1, PingPongRules.NORMAL_SPEED, false, null, 0, 0.5, 0.5, 1_000),
                0,
                P1,
                2_000,
                null
        );
    }
}
