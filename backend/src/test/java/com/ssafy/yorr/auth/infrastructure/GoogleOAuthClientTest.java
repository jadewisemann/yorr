package com.ssafy.yorr.auth.infrastructure;

import com.ssafy.yorr.auth.SocialLoginException;
import com.ssafy.yorr.auth.config.AuthProperties;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GoogleOAuthClientTest {

    private static final String REDIRECT_URI =
            "http://localhost:8080/api/v1/auth/google/callback";

    private static GoogleOAuthClient client(String clientId, String clientSecret,
                                             String redirectUri) {
        return new GoogleOAuthClient(RestClient.builder().build(), new AuthProperties(
                "http://localhost:5173/auth/callback",
                null,
                new AuthProperties.Google(clientId, clientSecret, redirectUri)));
    }

    @Test
    void 인가_주소에_필수_파라미터를_인코딩해_담는다() {
        String url = client("client-id", "secret", REDIRECT_URI)
                .authorizeUrl("state-1", false);

        assertThat(url).startsWith("https://accounts.google.com/o/oauth2/v2/auth?");
        assertThat(url).contains("response_type=code");
        assertThat(url).contains("client_id=client-id");
        assertThat(url).contains("redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fapi%2Fv1%2Fauth%2Fgoogle%2Fcallback");
        assertThat(url).contains("scope=openid+profile+email");
        assertThat(url).contains("state=state-1");
        assertThat(url).doesNotContain("prompt=select_account");
    }

    @Test
    void 계정_선택을_요청하면_prompt를_붙인다() {
        String url = client("client-id", "secret", REDIRECT_URI)
                .authorizeUrl("state-1", true);

        assertThat(url).contains("prompt=select_account");
    }

    @Test
    void 필수_설정이_없으면_로그인을_시작하지_않는다() {
        assertThatThrownBy(() -> client("", "secret", REDIRECT_URI)
                .authorizeUrl("state-1", false))
                .isInstanceOf(SocialLoginException.class)
                .extracting("reason")
                .isEqualTo(SocialLoginException.Reason.NOT_CONFIGURED);
    }
}
