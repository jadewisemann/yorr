package com.ssafy.yorr.game.ranking.controller;

import com.ssafy.yorr.game.ranking.application.WeeklyRankingService;
import com.ssafy.yorr.game.ranking.controller.dto.WeeklyRankingResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 랭킹 조회. <b>인증을 요구하지 않는다</b> — 순위에 오르는 것은 회원만이지만, 보는 것은 누구나다.
 * 로그인해야 볼 수 있게 하면 "로그인하면 무엇이 남는가"를 보여줄 자리가 사라진다.
 */
@RestController
@RequestMapping("/api/v1/rankings")
@RequiredArgsConstructor
@Tag(name = "Ranking", description = "랭킹 조회 API")
public class RankingController {

    private final WeeklyRankingService weeklyRankingService;

    @GetMapping("/weekly")
    @Operation(summary = "이번 주 최고점 랭킹",
            description = "월요일 00:00 KST부터 지금까지 끝난 판에서 회원별 한 판 최고점을 내림차순으로 돌려줍니다. 게스트는 집계에 포함되지 않습니다.")
    public ResponseEntity<WeeklyRankingResponse> weekly(
            @RequestParam(defaultValue = "" + WeeklyRankingService.MAX_LIMIT) int limit) {
        return ResponseEntity.ok(
                WeeklyRankingResponse.of(weeklyRankingService.currentWeek(limit)));
    }
}
