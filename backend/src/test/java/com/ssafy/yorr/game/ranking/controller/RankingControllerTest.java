package com.ssafy.yorr.game.ranking.controller;

import com.ssafy.yorr.game.match.repository.MatchParticipantRepository.WeeklyBest;
import com.ssafy.yorr.game.ranking.application.WeeklyRankingService;
import com.ssafy.yorr.game.ranking.application.WeeklyRankingService.WeeklyRanking;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDate;
import java.util.List;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 엔드포인트 배선(경로·limit 기본값·JSON 모양)만 본다. 인증 헤더 없이 200이 나오는 것 자체가
 * "오르는 것은 회원만, 보는 것은 누구나"를 지키고 있다는 확인이다.
 */
class RankingControllerTest {

    private WeeklyRankingService service;
    private MockMvc mockMvc;

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

    @BeforeEach
    void setUp() {
        service = mock(WeeklyRankingService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new RankingController(service)).build();
    }

    /** 순위 번호는 응답을 만들 때 붙는다 — 서비스는 정렬된 점수만 준다. */
    @Test
    void 순위와_주_시작일을_함께_돌려준다() throws Exception {
        when(service.currentWeek(anyInt())).thenReturn(new WeeklyRanking(
                LocalDate.of(2026, 8, 3),
                List.of(new Row("u1", "일등", 300), new Row("u2", "이등", 250))));

        mockMvc.perform(get("/api/v1/rankings/weekly"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.weekStart").value("2026-08-03"))
                .andExpect(jsonPath("$.entries[0].rank").value(1))
                .andExpect(jsonPath("$.entries[0].userId").value("u1"))
                .andExpect(jsonPath("$.entries[0].nickname").value("일등"))
                .andExpect(jsonPath("$.entries[0].bestScore").value(300))
                .andExpect(jsonPath("$.entries[1].rank").value(2));
    }

    @Test
    void limit을_주지_않으면_상한만큼_요청한다() throws Exception {
        when(service.currentWeek(anyInt()))
                .thenReturn(new WeeklyRanking(LocalDate.of(2026, 8, 3), List.of()));

        mockMvc.perform(get("/api/v1/rankings/weekly")).andExpect(status().isOk());

        verify(service).currentWeek(WeeklyRankingService.MAX_LIMIT);
    }

    @Test
    void limit을_주면_그_값으로_요청한다() throws Exception {
        when(service.currentWeek(anyInt()))
                .thenReturn(new WeeklyRanking(LocalDate.of(2026, 8, 3), List.of()));

        mockMvc.perform(get("/api/v1/rankings/weekly").param("limit", "10"))
                .andExpect(status().isOk());

        verify(service).currentWeek(10);
    }
}
