package com.ssafy.yorr.game.pingpong;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class PingPongRulesTest {

    private static final String P1 = "player-1";
    private static final String P2 = "player-2";

    /**
     * 업링크 지연은 되감아 주되, 미래에서 온 스윙과 죽은 공을 친 스윙은 잘라낸다.
     * 되감기 한계 120ms 는 PingPongRules.MAX_ROLLBACK_MILLIS.
     */
    @Test
    void judgedAtRewindsTheUplinkDelayWithinBounds() {
        assertThat(PingPongRules.judgedAt(10_000, 9_920)).isEqualTo(9_920);
        assertThat(PingPongRules.judgedAt(10_000, 10_050)).isEqualTo(10_000);
        assertThat(PingPongRules.judgedAt(10_000, 9_000)).isEqualTo(9_880);
    }

    @Test
    void exactTimingReturnsASmashAndDuplicateInputIsIgnored() {
        PingPongState served = startMatch();

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
        PingPongState served = startMatch();

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

    @Test
    void bothPlayersPracticeAndReadyBeforeTheCountdownStarts() {
        PingPongState state = PingPongRules.initial(List.of(P1, P2), 1_000);
        assertThat(state.phase()).isEqualTo(PingPongState.Phase.PREPARING);
        assertThat(state.nextActionAt()).isZero();

        PingPongState ignoredReady = PingPongRules.ready(state, P1, 1_100);
        assertThat(ignoredReady).isEqualTo(state);

        PingPongState p1Practiced = PingPongRules.swing(state, P1, 0, 1_200, 0.5);
        PingPongState p1Ready = PingPongRules.ready(p1Practiced, P1, 1_300);
        assertThat(p1Ready.phase()).isEqualTo(PingPongState.Phase.PREPARING);
        assertThat(p1Ready.readyPlayerIds()).containsExactly(P1);

        PingPongState p2Practiced = PingPongRules.swing(p1Ready, P2, 0, 1_400, 0.5);
        PingPongState allReady = PingPongRules.ready(p2Practiced, P2, 1_500);
        assertThat(allReady.phase()).isEqualTo(PingPongState.Phase.COUNTDOWN);
        assertThat(allReady.readyPlayerIds()).containsExactlyInAnyOrder(P1, P2);
        assertThat(allReady.nextActionAt()).isEqualTo(1_500 + PingPongRules.POINT_COUNTDOWN_MILLIS);
    }

    private PingPongState startMatch() {
        PingPongState state = PingPongRules.initial(List.of(P1, P2), 1_000);
        state = PingPongRules.swing(state, P1, 0, 1_100, 0.5);
        state = PingPongRules.ready(state, P1, 1_200);
        state = PingPongRules.swing(state, P2, 0, 1_300, 0.5);
        state = PingPongRules.ready(state, P2, 1_400);
        return PingPongRules.serve(state, 4_000, 0.7);
    }

    private PingPongState playingAtScore(int p1, int p2) {
        return new PingPongState(
                1,
                PingPongState.Phase.PLAYING,
                List.of(P1, P2),
                Map.of(P1, p1, P2, p2),
                Map.of(P1, -1L, P2, -1L),
                Set.of(P1, P2),
                new PingPongState.Ball(0, 1, PingPongRules.NORMAL_SPEED, false, null, 0, 0.5, 0.5, 1_000),
                0,
                P1,
                2_000,
                null
        );
    }
}
