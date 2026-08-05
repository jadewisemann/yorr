package com.ssafy.yorr.game.teamyacht;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.ssafy.yorr.game.domain.ScoreBoard;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 한 플레이어가 볼 수 있는 만큼의 판(S15P11A406-209). {@code game.team_yacht.state}의 payload다.
 * <p>
 * <b>가리는 일은 여기서 끝난다.</b> 앞 주자가 버린 주사위 눈은 이 값에 애초에 담기지 않는다
 * ({@code dice}의 해당 자리가 null) — 내려보내고 화면에서 가리면 개발자 도구로 다 보인다.
 * <p>
 * 눈이 보이는 조건은 둘 중 하나다: <b>이미 킵돼 잠긴 주사위</b>(모두에게 공개)이거나,
 * <b>내가 지금 굴린 주자</b>(내가 판단해야 하니 다 본다). 마지막 주자가 굴리면 5개가 모두
 * 잠기므로, 투표 단계에서는 세 명이 같은 손패를 본다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record TeamYachtView(
        TeamYachtState.Stage stage,
        int round,
        int rounds,
        /** 이번 라운드의 주자 순서(index 0 = 1번 주자). */
        List<String> seats,
        int leg,
        String runnerId,
        /** 주사위 5개. 내게 보이지 않는 자리는 null이다. */
        List<Integer> dice,
        List<Boolean> kept,
        /** 지금 주자가 킵해야 하는 개수 범위. 킵 단계가 아니면 둘 다 0이다. */
        int minKeep,
        int maxKeep,
        Map<String, String> votes,
        ScoreBoard board,
        TeamYachtState.Recorded last
) {

    public static TeamYachtView of(TeamYachtState state, String viewerId) {
        boolean runner = viewerId != null && viewerId.equals(state.runnerId());
        List<Integer> dice = new ArrayList<>(TeamYachtRules.DICE_COUNT);
        for (int index = 0; index < TeamYachtRules.DICE_COUNT; index++) {
            int face = state.dice().get(index);
            boolean visible = face != 0 && (state.kept().get(index) || runner);
            dice.add(visible ? face : null);
        }
        boolean keeping = state.stage() == TeamYachtState.Stage.KEEP;
        TeamYachtRules.KeepBounds bounds = keeping
                ? TeamYachtRules.keepBounds(state)
                : new TeamYachtRules.KeepBounds(0, 0);

        return new TeamYachtView(
                state.stage(), state.round(), TeamYachtRules.ROUNDS, state.seats(), state.leg(),
                state.runnerId(), dice, state.kept(), bounds.min(), bounds.max(),
                state.votes(), TeamYachtRules.board(state.recorded()), state.last());
    }
}
