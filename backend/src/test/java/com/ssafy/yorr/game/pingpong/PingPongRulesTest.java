package com.ssafy.yorr.game.pingpong;

import org.junit.jupiter.api.Test;

import java.util.List;

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
    void missingTheBallAwardsTheOpponentAndServesTheLoserNext() {
        PingPongState initial = PingPongRules.initial(List.of(P1, P2), 1_000);
        PingPongState served = PingPongRules.serve(initial, 4_000, 0.7);

        PingPongState point = PingPongRules.expire(served, served.nextActionAt());

        assertThat(point.phase()).isEqualTo(PingPongState.Phase.COUNTDOWN);
        assertThat(point.scores()).containsEntry(P2, 1).containsEntry(P1, 0);
        assertThat(point.serveReceiverId()).isEqualTo(P1);
        assertThat(point.lastEvent().type()).isEqualTo(PingPongState.EventType.POINT);
    }

    @Test
    void leavingPlayerForfeitsTheMatch() {
        PingPongState state = PingPongRules.initial(List.of(P1, P2), 1_000);

        PingPongState finished = PingPongRules.forfeit(state, P1, 2_000);

        assertThat(finished.finished()).isTrue();
        assertThat(finished.scores()).containsEntry(P2, PingPongRules.WIN_SCORE);
        assertThat(finished.lastEvent().type()).isEqualTo(PingPongState.EventType.OPPONENT_LEFT);
    }
}
