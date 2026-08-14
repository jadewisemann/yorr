package com.ssafy.yorr.game.duel;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DuelRulesTest {

    private static final String P1 = "player-1";
    private static final String P2 = "player-2";

    @Test
    void fasterDrawShootsTheOpponent() {
        DuelState signalled = DuelRules.signal(initial(), 5_000);

        DuelState first = DuelRules.draw(signalled, P1, 1, 180, 5_200);
        DuelState resolved = DuelRules.draw(first, P2, 1, 240, 5_260);

        assertThat(resolved.phase()).isEqualTo(DuelState.Phase.RESULT);
        assertThat(resolved.lastRound().kind()).isEqualTo(DuelState.Kind.SHOT);
        assertThat(resolved.lastRound().shooterId()).isEqualTo(P1);
        assertThat(resolved.hp()).containsEntry(P1, DuelRules.MAX_HP).containsEntry(P2, DuelRules.MAX_HP - 1);
        assertThat(resolved.lastRound().over()).isFalse();
    }

    @Test
    void sameMillisecondIsATieAndNobodyLosesABullet() {
        DuelState signalled = DuelRules.signal(initial(), 5_000);

        DuelState first = DuelRules.draw(signalled, P1, 1, 200, 5_220);
        DuelState resolved = DuelRules.draw(first, P2, 1, 200, 5_230);

        assertThat(resolved.lastRound().kind()).isEqualTo(DuelState.Kind.TIE);
        assertThat(resolved.lastRound().hitId()).isNull();
        assertThat(resolved.hp()).containsEntry(P1, DuelRules.MAX_HP).containsEntry(P2, DuelRules.MAX_HP);
    }

    /** 첫 부정출발은 상대를 무피해로 두고 경고만 남긴다 — 손떨림 한 번에 체력을 깎지 않는다. */
    @Test
    void firstFalseStartOnlyWarns() {
        DuelState fouled = DuelRules.draw(initial(), P1, 1, 120, 2_000);

        assertThat(fouled.lastRound().kind()).isEqualTo(DuelState.Kind.WARNING);
        assertThat(fouled.lastRound().foulId()).isEqualTo(P1);
        assertThat(fouled.fouls()).containsEntry(P1, 1);
        assertThat(fouled.hp()).containsEntry(P1, DuelRules.MAX_HP).containsEntry(P2, DuelRules.MAX_HP);
    }

    /** 두 번째 부정출발은 총알이 남아 있어도 그 자리에서 결투를 끝낸다. */
    @Test
    void secondFalseStartLosesTheDuelOutright() {
        DuelState warned = DuelRules.nextRound(DuelRules.draw(initial(), P1, 1, -1, 2_000), 3_000, 1_500);

        DuelState selfShot = DuelRules.draw(warned, P1, 2, -1, 3_400);

        assertThat(selfShot.lastRound().kind()).isEqualTo(DuelState.Kind.SELF_SHOT);
        assertThat(selfShot.lastRound().hitId()).isEqualTo(P1);
        assertThat(selfShot.lastRound().koId()).isEqualTo(P1);
        assertThat(selfShot.lastRound().over()).isTrue();
        assertThat(selfShot.hp()).containsEntry(P1, DuelRules.MAX_HP - 1).containsEntry(P2, DuelRules.MAX_HP);
        // 경고는 리셋되지 않는다 — 이 값이 곧 실격 사유다.
        assertThat(selfShot.fouls()).containsEntry(P1, DuelRules.MAX_FOULS);
        assertThat(DuelRules.hold(selfShot.lastRound())).isEqualTo(DuelRules.KO_HOLD_MILLIS);
        assertThat(DuelRules.finish(selfShot).finished()).isTrue();
    }

    /** 경고는 라운드를 넘어 누적된다 — 라운드마다 두 번씩 기회를 주는 게 아니다. */
    @Test
    void warningsCarryAcrossRounds() {
        DuelState signalled = DuelRules.signal(initial(), 5_000);
        DuelState fouled = DuelRules.draw(signalled, P1, 1, -1, 5_100);

        assertThat(fouled.lastRound().kind()).isEqualTo(DuelState.Kind.WARNING);
        assertThat(fouled.fouls()).containsEntry(P1, 1);

        DuelState nextRound = DuelRules.nextRound(fouled, 9_000, 1_500);

        assertThat(nextRound.round()).isEqualTo(2);
        assertThat(nextRound.fouls()).containsEntry(P1, 1);
    }

    /** 신호 전 입력은 payload가 어떤 ms를 신고해도 부정출발이다 — 판정 권한은 서버에 있다. */
    @Test
    void drawBeforeTheSignalIsAlwaysAFalseStart() {
        DuelState fouled = DuelRules.draw(initial(), P2, 1, 999, 2_000);

        assertThat(fouled.reactions()).containsEntry(P2, DuelRules.FOUL);
    }

    /** 서버에 흐른 시간보다 빠른 기록은 낼 수 없다 — 왕복 지연만큼은 클라이언트 편을 들어준다. */
    @Test
    void reportedReactionIsCappedByServerElapsedTime() {
        DuelState signalled = DuelRules.signal(initial(), 5_000);

        DuelState drawn = DuelRules.draw(signalled, P1, 1, 900, 5_400);

        assertThat(drawn.reactions()).containsEntry(P1, 400);
    }

    @Test
    void nobodyDrawingVoidsTheRound() {
        DuelState signalled = DuelRules.signal(initial(), 5_000);

        DuelState expired = DuelRules.expire(signalled, signalled.nextActionAt());

        assertThat(expired.lastRound().kind()).isEqualTo(DuelState.Kind.TIE);
        assertThat(expired.reactions()).containsEntry(P1, DuelRules.MISS).containsEntry(P2, DuelRules.MISS);
        assertThat(expired.hp()).containsEntry(P1, DuelRules.MAX_HP).containsEntry(P2, DuelRules.MAX_HP);
    }

    /** 한쪽만 뽑고 유예가 끝나면 얼어붙은 쪽이 그대로 맞는다. */
    @Test
    void frozenPlayerTakesTheBullet() {
        DuelState signalled = DuelRules.signal(initial(), 5_000);
        DuelState drawn = DuelRules.draw(signalled, P1, 1, 200, 5_200);

        DuelState resolved = DuelRules.expire(drawn, drawn.nextActionAt());

        assertThat(resolved.lastRound().shooterId()).isEqualTo(P1);
        assertThat(resolved.hp()).containsEntry(P2, DuelRules.MAX_HP - 1);
    }

    @Test
    void thirdHitEndsTheDuelAndThenFinishes() {
        DuelState state = initial();
        for (int round = 0; round < DuelRules.MAX_HP; round++) {
            long signalAt = 5_000L + round * 10_000L;
            state = DuelRules.signal(state, signalAt);
            state = DuelRules.draw(state, P1, round + 1, 180, signalAt + 200);
            state = DuelRules.draw(state, P2, round + 1, 300, signalAt + 320);
            if (!state.lastRound().over()) state = DuelRules.nextRound(state, signalAt + 4_000, 1_500);
        }

        assertThat(state.hp()).containsEntry(P2, 0);
        assertThat(state.lastRound().koId()).isEqualTo(P2);
        assertThat(state.lastRound().over()).isTrue();
        assertThat(state.phase()).isEqualTo(DuelState.Phase.RESULT);
        assertThat(DuelRules.hold(state.lastRound())).isEqualTo(DuelRules.KO_HOLD_MILLIS);

        DuelState finished = DuelRules.finish(state);

        assertThat(finished.finished()).isTrue();
    }

    @Test
    void duplicateInputSequenceIsIgnored() {
        DuelState signalled = DuelRules.signal(initial(), 5_000);
        DuelState drawn = DuelRules.draw(signalled, P1, 1, 200, 5_200);

        DuelState repeated = DuelRules.draw(drawn, P1, 1, 100, 5_300);

        assertThat(repeated).isEqualTo(drawn);
    }

    @Test
    void leavingPlayerForfeitsTheDuel() {
        DuelState finished = DuelRules.forfeit(initial(), P1, 2_000);

        assertThat(finished.finished()).isTrue();
        assertThat(finished.hp()).containsEntry(P1, 0).containsEntry(P2, DuelRules.MAX_HP);
        assertThat(finished.lastRound().kind()).isEqualTo(DuelState.Kind.FORFEIT);
        assertThat(finished.lastRound().shooterId()).isEqualTo(P2);
    }

    private static DuelState initial() {
        return DuelRules.initial(List.of(P1, P2), 1_000, 2_000);
    }
}
