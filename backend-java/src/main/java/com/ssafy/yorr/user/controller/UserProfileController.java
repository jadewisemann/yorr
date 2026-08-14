package com.ssafy.yorr.user.controller;

import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.application.UserProfileService;
import com.ssafy.yorr.user.controller.dto.ProfileResponse;
import com.ssafy.yorr.user.controller.dto.RenameRequest;
import com.ssafy.yorr.user.domain.User;
import com.ssafy.yorr.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 프로필. 회원만 쓴다 — 게스트는 고칠 프로필이 없다(계정 자체가 없다).
 */
@RestController
@RequestMapping("/api/v1/users/me")
@RequiredArgsConstructor
@Tag(name = "Profile", description = "내 프로필 조회·수정 API")
public class UserProfileController {

    private final UserProfileService profileService;
    private final UserService userService;

    @GetMapping
    @Operation(summary = "내 프로필 조회", description = "Authorization: Bearer {sessionToken}")
    public ResponseEntity<?> read(@RequestHeader(value = "Authorization", required = false) String authorization) {
        return withMember(authorization, member -> {
            User user = profileService.read(member.userId());
            return ResponseEntity.ok(ProfileResponse.of(user));
        });
    }

    @PatchMapping
    @Operation(summary = "닉네임 변경", description = "지난 판의 기록에 남은 이름은 바뀌지 않습니다.")
    public ResponseEntity<?> rename(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody RenameRequest request
    ) {
        return withMember(authorization, member -> {
            try {
                User user = profileService.rename(member.userId(), request == null ? null : request.nickname());
                return ResponseEntity.ok(ProfileResponse.of(user));
            } catch (IllegalArgumentException e) {
                // 닉네임 규칙 위반과 "그런 회원이 없다"를 구분해 알린다.
                return "user_not_found".equals(e.getMessage())
                        ? ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage())
                        : ResponseEntity.badRequest().body(e.getMessage());
            }
        });
    }

    /**
     * 세션을 확인하고 <b>회원인지</b>까지 본다. 게스트 토큰으로 들어오면 401이 아니라 403이다 —
     * 인증은 됐지만 프로필이라는 것 자체가 없는 상태라, 다시 로그인해도 달라지지 않는다.
     */
    private ResponseEntity<?> withMember(String authorization, java.util.function.Function<UserIdentity, ResponseEntity<?>> action) {
        UserIdentity identity;
        try {
            identity = userService.authenticateSession(bearerToken(authorization));
        } catch (SessionAuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("session_expired");
        }
        if (identity.type() != UserType.MEMBER) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body("member_only");
        }
        return action.apply(identity);
    }

    private static String bearerToken(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) return null;
        return authorization.substring(7);
    }
}
