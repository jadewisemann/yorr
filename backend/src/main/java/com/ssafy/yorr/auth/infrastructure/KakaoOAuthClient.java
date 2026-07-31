package com.ssafy.yorr.auth.infrastructure;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.ssafy.yorr.auth.SocialLoginException;
import com.ssafy.yorr.auth.config.AuthProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * 카카오 OAuth 호출. 인가 코드를 토큰으로 바꾸고 프로필을 읽어오는 두 가지 일만 한다.
 * <p>
 * Spring Security의 OAuth2 클라이언트를 쓰지 않은 이유: 이 서버에는 Security 자체가 없어서,
 * 의존성을 넣는 순간 필터 체인 · CORS · WebSocket 인증까지 전부 다시 맞춰야 한다. 실제로
 * 필요한 것은 아래 두 번의 HTTP 호출뿐이다.
 */
@Component
public class KakaoOAuthClient {

    private static final String AUTHORIZE_URI = "https://kauth.kakao.com/oauth/authorize";
    private static final String TOKEN_URI = "https://kauth.kakao.com/oauth/token";
    private static final String USER_INFO_URI = "https://kapi.kakao.com/v2/user/me";
    /** 닉네임을 못 받았을 때 쓰는 값. 동의항목을 거절해도 로그인 자체는 되어야 한다. */
    private static final String FALLBACK_NICKNAME = "플레이어";
    /** users.nickname 컬럼 길이. 카카오 닉네임이 더 길면 잘라서 저장한다. */
    private static final int NICKNAME_MAX_LENGTH = 20;

    private static final Logger log = LoggerFactory.getLogger(KakaoOAuthClient.class);

    private final RestClient restClient;
    private final AuthProperties properties;

    public KakaoOAuthClient(RestClient socialRestClient, AuthProperties properties) {
        this.restClient = socialRestClient;
        this.properties = properties;
    }

    /**
     * 사용자를 보낼 카카오 동의 화면 주소.
     * <p>
     * 값을 직접 퍼센트 인코딩한다 — {@code UriComponentsBuilder.encode()}는 쿼리값 안의
     * {@code :}와 {@code /}를 그대로 둔다(RFC상 쿼리에서 허용되는 문자라서). redirect_uri는
     * OAuth 규격상 form-urlencoded여야 하고, 인코딩하지 않으면 값에 특수문자가 섞이는 순간
     * 제공자가 파라미터를 잘라 읽는다.
     */
    public String authorizeUrl(String state) {
        AuthProperties.Kakao kakao = requireConfigured();
        return AUTHORIZE_URI
                + "?response_type=code"
                + "&client_id=" + encode(kakao.clientId())
                + "&redirect_uri=" + encode(kakao.redirectUri())
                + "&state=" + encode(state);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    /**
     * 인가 코드로 프로필을 가져온다. 토큰은 여기서만 쓰고 저장하지 않는다 — 우리는 카카오 API를
     * 대신 호출할 일이 없고, 보관하면 유출 표면만 넓어진다.
     */
    public KakaoProfile fetchProfile(String code) {
        AuthProperties.Kakao kakao = requireConfigured();
        String accessToken = exchangeToken(kakao, code);
        KakaoUserResponse user = fetchUser(accessToken);
        if (user == null || user.id() == null) {
            throw new SocialLoginException(SocialLoginException.Reason.PROVIDER_ERROR,
                    "kakao_user_id_missing", null);
        }
        return new KakaoProfile(String.valueOf(user.id()), nickname(user), profileImageUrl(user));
    }

    private String exchangeToken(AuthProperties.Kakao kakao, String code) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "authorization_code");
        form.add("client_id", kakao.clientId());
        form.add("redirect_uri", kakao.redirectUri());
        form.add("code", code);
        if (kakao.clientSecret() != null && !kakao.clientSecret().isBlank()) {
            form.add("client_secret", kakao.clientSecret());
        }
        try {
            KakaoTokenResponse token = restClient.post()
                    .uri(TOKEN_URI)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(KakaoTokenResponse.class);
            if (token == null || token.accessToken() == null || token.accessToken().isBlank()) {
                throw new SocialLoginException(SocialLoginException.Reason.PROVIDER_ERROR,
                        "kakao_token_missing", null);
            }
            return token.accessToken();
        } catch (RestClientException e) {
            // 응답 본문에 코드가 담겨 있어도 그대로 흘리지 않는다 — 클라이언트 키가 섞여 나올 수 있다.
            log.warn("카카오 토큰 교환 실패", e);
            throw new SocialLoginException(SocialLoginException.Reason.PROVIDER_ERROR,
                    "kakao_token_exchange_failed", e);
        }
    }

    private KakaoUserResponse fetchUser(String accessToken) {
        try {
            return restClient.get()
                    .uri(USER_INFO_URI)
                    .header("Authorization", "Bearer " + accessToken)
                    .retrieve()
                    .body(KakaoUserResponse.class);
        } catch (RestClientException e) {
            log.warn("카카오 프로필 조회 실패", e);
            throw new SocialLoginException(SocialLoginException.Reason.PROVIDER_ERROR,
                    "kakao_user_fetch_failed", e);
        }
    }

    private AuthProperties.Kakao requireConfigured() {
        AuthProperties.Kakao kakao = properties.kakao();
        if (kakao == null || !kakao.configured()) {
            throw new SocialLoginException(SocialLoginException.Reason.NOT_CONFIGURED);
        }
        return kakao;
    }

    private static String nickname(KakaoUserResponse user) {
        String nickname = user.profile() == null ? null : user.profile().nickname();
        if (nickname == null || nickname.isBlank()) return FALLBACK_NICKNAME;
        String trimmed = nickname.trim();
        return trimmed.length() > NICKNAME_MAX_LENGTH ? trimmed.substring(0, NICKNAME_MAX_LENGTH) : trimmed;
    }

    private static String profileImageUrl(KakaoUserResponse user) {
        return user.profile() == null ? null : user.profile().profileImageUrl();
    }

    /** 제공자에 상관없이 로그인에 필요한 최소 정보. 구글을 붙일 때 이 형태를 그대로 쓴다. */
    public record KakaoProfile(String providerUserId, String nickname, String profileImageUrl) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record KakaoTokenResponse(@JsonProperty("access_token") String accessToken) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record KakaoUserResponse(
            @JsonProperty("id") Long id,
            @JsonProperty("kakao_account") KakaoAccount kakaoAccount
    ) {
        /** 동의항목을 거절하면 kakao_account · profile이 통째로 없을 수 있다. */
        Profile profile() {
            return kakaoAccount == null ? null : kakaoAccount.profile();
        }

        @JsonIgnoreProperties(ignoreUnknown = true)
        record KakaoAccount(@JsonProperty("profile") Profile profile) {
        }

        @JsonIgnoreProperties(ignoreUnknown = true)
        record Profile(
                @JsonProperty("nickname") String nickname,
                @JsonProperty("profile_image_url") String profileImageUrl
        ) {
        }
    }
}
