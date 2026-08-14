package com.ssafy.yorr.ws.dto;

import java.util.List;

/**
 * S→C: 게임 종료 + 최종 순위. (SSOT: GameOverPayload)
 * <p>
 * 총점은 서버가 확정해 Redis에 쌓아둔 값이다 — 클라이언트가 계산한 점수는 순위에 들어오지 않는다.
 */
public record GameOverPayload(List<Ranking> rankings) {

    public GameOverPayload {
        rankings = rankings == null ? List.of() : List.copyOf(rankings);
    }

    /** rank는 1부터. 동점은 같은 rank를 공유한다. */
    public record Ranking(int rank, String playerId, int total) {}
}
