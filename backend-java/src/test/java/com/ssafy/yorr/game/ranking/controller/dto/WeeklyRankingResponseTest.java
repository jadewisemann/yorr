package com.ssafy.yorr.game.ranking.controller.dto;

import com.ssafy.yorr.game.match.repository.MatchParticipantRepository.WeeklyBest;
import com.ssafy.yorr.game.ranking.application.WeeklyRankingService.WeeklyRanking;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

class WeeklyRankingResponseTest {

    private record Row(String userId, String nickname, int bestScore) implements WeeklyBest {
        @Override
        public String getUserId() {
            return userId;
        }

        @Override
        public String getNickname() {
            return nickname;
        }

        @Override
        public int getBestScore() {
            return bestScore;
        }
    }

    @Test
    void 동점자는_같은_순위를_받고_다음_순위를_건너뛴다() {
        var ranking = new WeeklyRanking(LocalDate.of(2026, 8, 3), List.of(
                new Row("u1", "일등", 300),
                new Row("u2", "공동이등", 250),
                new Row("u3", "공동이등", 250),
                new Row("u4", "사등", 200)));

        var response = WeeklyRankingResponse.of(ranking);

        assertThat(response.weekStart()).isEqualTo(LocalDate.of(2026, 8, 3));
        assertThat(response.entries())
                .extracting(WeeklyRankingResponse.Entry::rank, WeeklyRankingResponse.Entry::userId)
                .containsExactly(
                        tuple(1, "u1"),
                        tuple(2, "u2"),
                        tuple(2, "u3"),
                        tuple(4, "u4"));
    }

    @Test
    void 아무도_없는_주는_빈_목록이다() {
        var response = WeeklyRankingResponse.of(
                new WeeklyRanking(LocalDate.of(2026, 8, 3), List.of()));

        assertThat(response.entries()).isEmpty();
    }
}
