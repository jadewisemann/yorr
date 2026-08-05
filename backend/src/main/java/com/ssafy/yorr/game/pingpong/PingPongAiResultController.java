package com.ssafy.yorr.game.pingpong;

import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/games/ping-pong/ai-results")
@RequiredArgsConstructor
@Tag(name = "Ping Pong", description = "탁구 게임 API")
public class PingPongAiResultController {

    private final PingPongAiResultService results;
    private final UserService users;

    @PostMapping
    @Operation(summary = "로컬 AI 탁구 결과 저장", description = "로그인 회원의 로컬 AI 경기 결과를 저장합니다.")
    public ResponseEntity<?> archive(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody(required = false) PingPongAiResultRequest request
    ) {
        final UserIdentity user;
        try {
            user = users.authenticateSession(bearerToken(authorization));
        } catch (SessionAuthenticationException exception) {
            return ResponseEntity.status(401).body("session_expired");
        }
        if (user.type() != UserType.MEMBER) {
            return ResponseEntity.status(403).body("member_only");
        }
        try {
            results.archive(user, request);
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException exception) {
            return ResponseEntity.badRequest().body(exception.getMessage());
        }
    }

    private static String bearerToken(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) return null;
        return authorization.substring(7);
    }
}
