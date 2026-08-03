package com.ssafy.yorr.game.ranking.controller;

import com.ssafy.yorr.game.ranking.application.WeeklyRankingService;
import com.ssafy.yorr.game.ranking.application.WeeklyRankingService.MyWeeklyRank;
import com.ssafy.yorr.game.ranking.controller.dto.MyWeeklyRankResponse;
import com.ssafy.yorr.game.ranking.controller.dto.WeeklyRankingResponse;
import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 랭킹 조회. 상위 목록은 <b>인증을 요구하지 않는다</b> — 순위에 오르는 것은 회원만이지만, 보는
 * 것은 누구나다. 로그인해야 볼 수 있게 하면 "로그인하면 무엇이 남는가"를 보여줄 자리가 사라진다.
 */
@RestController
@RequestMapping("/api/v1/rankings")
@RequiredArgsConstructor
@Tag(name = "Ranking", description = "랭킹 조회 API")
public class RankingController {

    private final WeeklyRankingService weeklyRankingService;
    private final UserService userService;

    @GetMapping("/weekly")
    @Operation(summary = "이번 주 최고점 랭킹",
            description = "월요일 00:00 KST부터 지금까지 끝난 판에서 회원별 한 판 최고점을 내림차순으로 돌려줍니다. 게스트는 집계에 포함되지 않습니다.")
    public ResponseEntity<WeeklyRankingResponse> weekly(
            @RequestParam(defaultValue = "" + WeeklyRankingService.MAX_LIMIT) int limit) {
        return ResponseEntity.ok(
                WeeklyRankingResponse.of(weeklyRankingService.currentWeek(limit)));
    }

    /**
     * 내 이번 주 순위. 상위 목록 밖에 있어도 자기 자리를 알 수 있어야 한다 — 목록만으로는
     * "내가 어디 있는지"에 영원히 답할 수 없다.
     * <p>
     * 이번 주 기록이 없으면 <b>204</b>다. 빈 값을 200으로 돌려주면 "0점으로 최하위"와 "아직
     * 한 판도 안 했다"를 클라이언트가 구분할 수 없다.
     */
    @GetMapping("/weekly/me")
    @Operation(summary = "내 이번 주 순위",
            description = "Authorization: Bearer {sessionToken}. 이번 주 기록이 없으면 204를 돌려줍니다.")
    public ResponseEntity<?> myWeekly(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        UserIdentity identity;
        try {
            identity = userService.authenticateSession(bearerToken(authorization));
        } catch (SessionAuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("session_expired");
        }
        // 게스트는 인증은 됐지만 오를 자리 자체가 없다 — 다시 로그인해도 달라지지 않으므로 403이다.
        if (identity.type() != UserType.MEMBER) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body("member_only");
        }

        MyWeeklyRank rank = weeklyRankingService.myCurrentWeek(identity.userId());
        return rank == null
                ? ResponseEntity.noContent().build()
                : ResponseEntity.ok(MyWeeklyRankResponse.of(rank));
    }

    private static String bearerToken(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) return null;
        return authorization.substring(7);
    }
}
