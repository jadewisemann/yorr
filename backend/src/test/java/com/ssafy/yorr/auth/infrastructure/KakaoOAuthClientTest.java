package com.ssafy.yorr.auth.infrastructure;

import com.ssafy.yorr.auth.SocialLoginException;
import com.ssafy.yorr.auth.config.AuthProperties;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class KakaoOAuthClientTest {

    private static final String REDIRECT_URI = "http://localhost:8080/api/v1/auth/kakao/callback";

    private static KakaoOAuthClient client(String clientId, String redirectUri) {
        return new KakaoOAuthClient(RestClient.builder().build(), new AuthProperties(
                "http://localhost:5173/auth/callback",
                new AuthProperties.Kakao(clientId, "secret", redirectUri)));
    }

    /**
     * redirect_uri는 카카오 콘솔 등록값과 문자 하나까지 같아야 하고(KOE006), 쿼리 파라미터로
     * 실리므로 인코딩되어야 한다. 이 두 조건이 어긋나면 동의 화면에 도달조차 못 한다.
     */
    @Test
    void 동의_화면_주소에_필수_파라미터를_담고_redirect_uri를_인코딩한다() {
        String url = client("rest-api-key", REDIRECT_URI).authorizeUrl("state-1");

        assertThat(url).startsWith("https://kauth.kakao.com/oauth/authorize?");
        assertThat(url).contains("response_type=code");
        assertThat(url).contains("client_id=rest-api-key");
        assertThat(url).contains("state=state-1");
        assertThat(url).contains("redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fapi%2Fv1%2Fauth%2Fkakao%2Fcallback");
        // 인코딩되지 않은 원본이 그대로 남아 있으면 카카오가 파라미터를 잘라 읽는다.
        assertThat(url).doesNotContain("redirect_uri=" + REDIRECT_URI);
    }

    /** 환경변수가 없는 팀원의 로컬에서도 서버는 떠야 한다 — 대신 호출 시점에 사유가 분명해야 한다. */
    @Test
    void 설정이_비어_있으면_NOT_CONFIGURED로_거절한다() {
        assertThatThrownBy(() -> client("", REDIRECT_URI).authorizeUrl("state-1"))
                .isInstanceOf(SocialLoginException.class)
                .extracting(e -> ((SocialLoginException) e).reason())
                .isEqualTo(SocialLoginException.Reason.NOT_CONFIGURED);

        assertThatThrownBy(() -> client("rest-api-key", null).fetchProfile("code"))
                .isInstanceOf(SocialLoginException.class)
                .extracting(e -> ((SocialLoginException) e).reason())
                .isEqualTo(SocialLoginException.Reason.NOT_CONFIGURED);
    }
}
