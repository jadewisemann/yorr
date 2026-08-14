package com.ssafy.yorr.game.round.domain;

import java.util.List;

public record RoundCompletion(
        int roundNumber,
        List<String> submittedPlayerIds,
        /** 게임이 끝났다면 다음 라운드가 없으므로 {@code roundNumber}와 같다. */
        int nextRoundNumber,
        /**
         * 마지막 라운드가 끝났는지. 이게 true면 다음 턴 타이머를 걸어선 안 된다.
         * <p>
         * 게임 종료의 <b>주 판정은 Redis</b>(전원 점수판 12칸 완료 + phase CAS)이고 이 플래그는
         * 안전망이다. 타임아웃으로 빈 칸이 남아 Redis 판정이 성립하지 않아도 라운드 상한에서
         * 반드시 멈추게 해 라운드가 무한히 증가하는 것을 막는다.
         */
        boolean gameCompleted
) {

    public RoundCompletion {
        submittedPlayerIds = List.copyOf(submittedPlayerIds);
    }

    /** 기존 호출부(테스트 포함) 호환 — 게임 종료가 아닌 일반 라운드 완료. */
    public RoundCompletion(int roundNumber, List<String> submittedPlayerIds, int nextRoundNumber) {
        this(roundNumber, submittedPlayerIds, nextRoundNumber, false);
    }
}
