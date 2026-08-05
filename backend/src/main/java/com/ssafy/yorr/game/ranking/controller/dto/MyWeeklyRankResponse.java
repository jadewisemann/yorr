package com.ssafy.yorr.game.ranking.controller.dto;

import com.ssafy.yorr.game.ranking.application.WeeklyRankingService.MyWeeklyRank;

import java.time.LocalDate;

/**
 * 내 이번 주 순위.
 *
 * @param rank 상위 목록과 같은 번호 체계다 — 목록에 내가 있으면 거기 적힌 번호와 일치한다
 */
public record MyWeeklyRankResponse(LocalDate weekStart, int rank, int bestScore) {

    public static MyWeeklyRankResponse of(MyWeeklyRank rank) {
        return new MyWeeklyRankResponse(rank.weekStart(), rank.rank(), rank.bestScore());
    }
}
