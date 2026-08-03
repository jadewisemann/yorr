package com.ssafy.yorr.game.ranking.controller.dto;

import com.ssafy.yorr.game.match.repository.MatchParticipantRepository.WeeklyBest;
import com.ssafy.yorr.game.ranking.application.WeeklyRankingService.WeeklyRanking;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/**
 * 주간 랭킹 응답.
 *
 * @param weekStart 이 순위가 속한 주의 시작 날짜(KST 월요일)
 */
public record WeeklyRankingResponse(LocalDate weekStart, List<Entry> entries) {

    /**
     * @param rank      1부터. 동점자는 같은 번호를 받는다
     * @param bestScore 이 주에 낸 한 판 최고점
     */
    public record Entry(int rank, String userId, String nickname, int bestScore) {
    }

    /**
     * 순위 번호는 <b>서버가 매긴다</b> — 동점 처리를 클라이언트마다 다르게 하면 같은 데이터가
     * 화면마다 다른 순위로 보인다.
     * <p>
     * 동점은 같은 번호를 주고 다음 번호를 건너뛴다(1, 2, 2, 4). 순위 번호가 곧 "나보다 잘한
     * 사람이 몇 명인가"를 뜻하게 되어, 동점자가 있어도 아래 사람의 번호가 밀려나지 않는다.
     */
    public static WeeklyRankingResponse of(WeeklyRanking ranking) {
        List<WeeklyBest> rows = ranking.rows();
        List<Entry> entries = new ArrayList<>(rows.size());

        int rank = 0;
        Integer previousScore = null;
        for (int index = 0; index < rows.size(); index++) {
            WeeklyBest row = rows.get(index);
            if (previousScore == null || row.getBestScore() != previousScore) {
                rank = index + 1;
                previousScore = row.getBestScore();
            }
            entries.add(new Entry(rank, row.getUserId(), row.getNickname(), row.getBestScore()));
        }
        return new WeeklyRankingResponse(ranking.weekStart(), List.copyOf(entries));
    }
}
