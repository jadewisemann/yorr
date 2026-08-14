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

/** Google OAuth 인가 코드 교환과 사용자 프로필 조회를 담당한다. */
@Component
public class GoogleOAuthClient {

    private static final String AUTHORIZE_URI = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN_URI = "https://oauth2.googleapis.com/token";
    private static final String USER_INFO_URI = "https://openidconnect.googleapis.com/v1/userinfo";
    private static final String FALLBACK_NICKNAME = com.ssafy.yorr.user.domain.User.PLACEHOLDER_NICKNAME;
    private static final int NICKNAME_MAX_LENGTH = 20;
    private static final Logger log = LoggerFactory.getLogger(GoogleOAuthClient.class);

    private final RestClient restClient;
    private final AuthProperties properties;

    public GoogleOAuthClient(RestClient socialRestClient, AuthProperties properties) {
        this.restClient = socialRestClient;
        this.properties = properties;
    }

    public String authorizeUrl(String state, boolean selectAccount) {
        AuthProperties.Google google = requireConfigured();
        return AUTHORIZE_URI
                + "?response_type=code"
                + "&client_id=" + encode(google.clientId())
                + "&redirect_uri=" + encode(google.redirectUri())
                + "&scope=" + encode("openid profile email")
                + "&state=" + encode(state)
                + (selectAccount ? "&prompt=select_account" : "");
    }

    public GoogleProfile fetchProfile(String code) {
        AuthProperties.Google google = requireConfigured();
        String accessToken = exchangeToken(google, code);
        GoogleUserResponse user = fetchUser(accessToken);
        if (user == null || user.subject() == null || user.subject().isBlank()) {
            throw new SocialLoginException(SocialLoginException.Reason.PROVIDER_ERROR,
                    "google_user_id_missing", null);
        }
        return new GoogleProfile(user.subject(), nickname(user), blankToNull(user.picture()));
    }

    private String exchangeToken(AuthProperties.Google google, String code) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "authorization_code");
        form.add("client_id", google.clientId());
        form.add("client_secret", google.clientSecret());
        form.add("redirect_uri", google.redirectUri());
        form.add("code", code);
        try {
            GoogleTokenResponse token = restClient.post()
                    .uri(TOKEN_URI)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(GoogleTokenResponse.class);
            if (token == null || token.accessToken() == null || token.accessToken().isBlank()) {
                throw new SocialLoginException(SocialLoginException.Reason.PROVIDER_ERROR,
                        "google_token_missing", null);
            }
            return token.accessToken();
        } catch (RestClientException e) {
            log.warn("구글 토큰 교환 실패", e);
            throw new SocialLoginException(SocialLoginException.Reason.PROVIDER_ERROR,
                    "google_token_exchange_failed", e);
        }
    }

    private GoogleUserResponse fetchUser(String accessToken) {
        try {
            return restClient.get()
                    .uri(USER_INFO_URI)
                    .header("Authorization", "Bearer " + accessToken)
                    .retrieve()
                    .body(GoogleUserResponse.class);
        } catch (RestClientException e) {
            log.warn("구글 프로필 조회 실패", e);
            throw new SocialLoginException(SocialLoginException.Reason.PROVIDER_ERROR,
                    "google_user_fetch_failed", e);
        }
    }

    private AuthProperties.Google requireConfigured() {
        AuthProperties.Google google = properties.google();
        if (google == null || !google.configured()) {
            throw new SocialLoginException(SocialLoginException.Reason.NOT_CONFIGURED);
        }
        return google;
    }

    private static String nickname(GoogleUserResponse user) {
        String value = blankToNull(user.name());
        if (value == null) value = blankToNull(user.email());
        if (value == null) return FALLBACK_NICKNAME;
        String trimmed = value.trim();
        return trimmed.length() > NICKNAME_MAX_LENGTH ? trimmed.substring(0, NICKNAME_MAX_LENGTH) : trimmed;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static String encode(String value) {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8);
    }

    public record GoogleProfile(String providerUserId, String nickname, String profileImageUrl) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record GoogleTokenResponse(@JsonProperty("access_token") String accessToken) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record GoogleUserResponse(
            @JsonProperty("sub") String subject,
            @JsonProperty("name") String name,
            @JsonProperty("email") String email,
            @JsonProperty("picture") String picture
    ) {
    }
}
