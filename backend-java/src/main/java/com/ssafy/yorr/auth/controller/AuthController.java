package com.ssafy.yorr.auth.controller;

import com.ssafy.yorr.auth.SocialLoginException;
import com.ssafy.yorr.auth.application.LoginCodeStore;
import com.ssafy.yorr.auth.application.OAuthStateStore;
import com.ssafy.yorr.auth.application.SocialLoginService;
import com.ssafy.yorr.auth.config.AuthProperties;
import com.ssafy.yorr.auth.controller.dto.LoginCodeExchangeRequest;
import com.ssafy.yorr.auth.controller.dto.SessionResponse;
import com.ssafy.yorr.auth.infrastructure.GoogleOAuthClient;
import com.ssafy.yorr.auth.infrastructure.KakaoOAuthClient;
import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.domain.SocialProvider;
import com.ssafy.yorr.user.domain.User;
import com.ssafy.yorr.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;

/**
 * 소셜 로그인 진입점.
 *
 * <pre>
 * 프론트 로그인 버튼
 *   → GET  /api/v1/auth/{provider}/authorize   state 발급 후 소셜 로그인 제공자로 302
 *   → (카카오 또는 구글 동의 화면)
 *   → GET  /api/v1/auth/{provider}/callback    state 검증 · 토큰 교환 · 가입/로그인 · 세션 발급
 *                                              → 프론트로 302 (일회용 code 동반)
 *   → POST /api/v1/auth/session                code를 세션 토큰으로 교환
 * </pre>
 *
 * 콜백이 세션 토큰을 URL에 직접 싣지 않는 이유는 {@link LoginCodeStore} 참고.
 */
@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
@Tag(name = "Auth", description = "소셜 로그인 API")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final KakaoOAuthClient kakaoClient;
    private final GoogleOAuthClient googleClient;
    private final OAuthStateStore stateStore;
    private final LoginCodeStore loginCodeStore;
    private final SocialLoginService socialLoginService;
    private final UserService userService;
    private final AuthProperties properties;

    /**
     * @param prompt {@code login}이면 카카오 로그인 화면을 다시 거치게 한다. 우리 쪽에서
     *               로그아웃해도 카카오 세션은 브라우저에 남아 다음 로그인이 즉시 통과하므로,
     *               계정을 바꾸려는 사용자에게 필요한 경로다.
     */
    @GetMapping("/kakao/authorize")
    @Operation(summary = "카카오 로그인 시작", description = "카카오 동의 화면으로 리다이렉트합니다. prompt=login이면 계정을 다시 선택하게 합니다.")
    public ResponseEntity<Void> authorize(@RequestParam(required = false) String prompt) {
        try {
            String url = kakaoClient.authorizeUrl(stateStore.issue(), "login".equals(prompt));
            return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(url)).build();
        } catch (SocialLoginException e) {
            // 설정이 없으면 리다이렉트할 곳도 없다. 브라우저가 직접 여는 주소라 상태 코드로 알린다.
            log.error("카카오 로그인을 시작할 수 없습니다: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
    }

    /**
     * 카카오가 사용자를 되돌려 보내는 지점. <b>사람이 브라우저로 도착하는 곳이므로 JSON을
     * 돌려주지 않는다</b> — 성공이든 실패든 프론트 화면으로 보내고, 실패는 error 파라미터로 알린다.
     *
     * @param error 사용자가 동의 화면에서 취소하면 code 대신 이 값이 온다
     */
    @GetMapping("/kakao/callback")
    @Operation(summary = "카카오 로그인 콜백", description = "카카오 콘솔에 등록한 Redirect URI입니다. 프론트로 리다이렉트합니다.")
    public ResponseEntity<Void> callback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String error
    ) {
        try {
            validateCallback(code, state, error);
            var profile = kakaoClient.fetchProfile(code);
            User user = socialLoginService.loginOrRegister(SocialProvider.KAKAO,
                    profile.providerUserId(), profile.nickname(), profile.profileImageUrl());
            String sessionToken = userService.openMemberSession(user.getId(), user.getNickname());
            return redirect(frontendUrl("code", loginCodeStore.issue(sessionToken)));
        } catch (SocialLoginException e) {
            log.warn("카카오 로그인 실패: reason={} message={}", e.reason(), e.getMessage());
            return redirect(frontendUrl("error", e.reason().name().toLowerCase()));
        }
    }

    @GetMapping("/google/authorize")
    @Operation(summary = "구글 로그인 시작", description = "구글 로그인 화면으로 리다이렉트합니다. prompt=select_account이면 계정을 다시 선택하게 합니다.")
    public ResponseEntity<Void> googleAuthorize(@RequestParam(required = false) String prompt) {
        try {
            String url = googleClient.authorizeUrl(
                    stateStore.issue(), "select_account".equals(prompt));
            return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(url)).build();
        } catch (SocialLoginException e) {
            log.error("구글 로그인을 시작할 수 없습니다: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
    }

    @GetMapping("/google/callback")
    @Operation(summary = "구글 로그인 콜백", description = "Google Cloud Console에 등록한 Redirect URI입니다. 프론트로 리다이렉트합니다.")
    public ResponseEntity<Void> googleCallback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String error
    ) {
        try {
            validateCallback(code, state, error);
            var profile = googleClient.fetchProfile(code);
            User user = socialLoginService.loginOrRegister(SocialProvider.GOOGLE,
                    profile.providerUserId(), profile.nickname(), profile.profileImageUrl());
            String sessionToken = userService.openMemberSession(user.getId(), user.getNickname());
            return redirect(frontendUrl("code", loginCodeStore.issue(sessionToken)));
        } catch (SocialLoginException e) {
            log.warn("구글 로그인 실패: reason={} message={}", e.reason(), e.getMessage());
            return redirect(frontendUrl("error", e.reason().name().toLowerCase()));
        }
    }

    @PostMapping("/session")
    @Operation(summary = "로그인 코드 교환", description = "콜백이 넘긴 일회용 코드를 세션 토큰으로 바꿉니다. 코드는 한 번만 쓸 수 있습니다.")
    public ResponseEntity<?> exchange(@RequestBody LoginCodeExchangeRequest request) {
        String sessionToken = loginCodeStore.consume(request == null ? null : request.code());
        if (sessionToken == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("invalid_login_code");
        }
        try {
            // 세션이 실제로 살아 있는지까지 여기서 확인된다 — 토큰만 돌려주고 끝내지 않는다.
            UserIdentity identity = userService.authenticateSession(sessionToken);
            return ResponseEntity.ok(new SessionResponse(
                    identity.userId(), identity.nickname(), identity.type().name(), sessionToken));
        } catch (SessionAuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("session_expired");
        }
    }

    /**
     * 저장된 세션이 아직 살아 있는지 확인한다.
     * <p>
     * 클라이언트는 로그인 상태를 로컬에 두고 복원하는데, 그 사이 서버 세션이 사라졌으면
     * <b>화면은 로그인인데 요청은 전부 401</b>인 상태가 된다. 앱이 뜰 때 한 번 물어보고
     * 죽었으면 조용히 정리할 수 있게 한다.
     */
    @GetMapping("/me")
    @Operation(summary = "내 세션 확인", description = "Authorization: Bearer {sessionToken}. 유효하지 않으면 401입니다.")
    public ResponseEntity<?> me(@RequestHeader(value = "Authorization", required = false) String authorization) {
        try {
            UserIdentity identity = userService.authenticateSession(bearerToken(authorization));
            return ResponseEntity.ok(new SessionResponse(
                    identity.userId(), identity.nickname(), identity.type().name(), null));
        } catch (SessionAuthenticationException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("session_expired");
        }
    }

    /**
     * 로그아웃. 응답은 항상 204다 — 토큰이 이미 죽었든 살아 있든 클라이언트가 할 일(로컬 정리)은
     * 같고, 여기서 구분해 알려주면 "이 토큰이 유효한가"를 묻는 도구가 된다.
     */
    @DeleteMapping("/session")
    @Operation(summary = "로그아웃", description = "Authorization: Bearer {sessionToken}. 서버 세션을 닫습니다.")
    public ResponseEntity<Void> signOut(
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        userService.closeSession(bearerToken(authorization));
        return ResponseEntity.noContent().build();
    }

    /** 헤더가 없거나 형식이 달라도 던지지 않는다 — 두 엔드포인트 모두 그 경우를 스스로 처리한다. */
    private static String bearerToken(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) return null;
        return authorization.substring(7);
    }

    private ResponseEntity<Void> redirect(String url) {
        return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(url)).build();
    }

    private void validateCallback(String code, String state, String error) {
        if (error != null && !error.isBlank()) {
            throw new SocialLoginException(SocialLoginException.Reason.CANCELED);
        }
        if (!stateStore.consume(state)) {
            throw new SocialLoginException(SocialLoginException.Reason.INVALID_STATE);
        }
        if (code == null || code.isBlank()) {
            throw new SocialLoginException(SocialLoginException.Reason.PROVIDER_ERROR,
                    "authorization_code_missing", null);
        }
    }

    private String frontendUrl(String name, String value) {
        return UriComponentsBuilder.fromUriString(properties.frontendRedirectUri())
                .queryParam(name, value)
                .encode()
                .toUriString();
    }
}
