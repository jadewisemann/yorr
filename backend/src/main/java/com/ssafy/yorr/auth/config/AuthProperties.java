package com.ssafy.yorr.auth.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 소셜 로그인 설정. 값은 전부 환경변수에서 온다(비밀은 저장소에 두지 않는다).
 * <p>
 * 값이 없어도 애플리케이션은 뜬다 — 로그인을 건드리지 않는 팀원의 로컬 부팅을 막지 않기
 * 위해서다. 대신 로그인 엔드포인트를 실제로 호출하는 시점에 명확한 오류로 거절한다.
 *
 * @param frontendRedirectUri 로그인을 끝낸 사용자를 되돌려 보낼 프론트 주소.
 *                            <b>카카오에 등록하는 값이 아니다</b> — 카카오는 백엔드 콜백까지만
 *                            돌려보내고, 거기서 프론트로 보내는 것은 우리 서버다.
 */
@ConfigurationProperties(prefix = "yorr.auth")
public record AuthProperties(String frontendRedirectUri, Kakao kakao, Google google) {

    /**
     * @param clientId     카카오 앱의 <b>REST API 키</b>(JavaScript 키가 아니다 — 토큰 교환은 서버가 한다)
     * @param clientSecret 콘솔에서 발급 후 상태를 "사용함"으로 바꿔야 실제로 적용된다
     * @param redirectUri  카카오 콘솔에 등록한 값과 <b>문자 하나까지 같아야 한다</b>.
     *                     끝 슬래시·포트·http/https가 다르면 KOE006으로 거절된다.
     */
    public record Kakao(String clientId, String clientSecret, String redirectUri) {

        public boolean configured() {
            return notBlank(clientId) && notBlank(redirectUri);
        }

        private static boolean notBlank(String value) {
            return value != null && !value.isBlank();
        }
    }

    /**
     * @param clientId     Google Cloud Console의 OAuth 2.0 웹 클라이언트 ID
     * @param clientSecret 같은 OAuth 클라이언트의 보안 비밀
     * @param redirectUri  승인된 리디렉션 URI에 등록한 백엔드 콜백 주소
     */
    public record Google(String clientId, String clientSecret, String redirectUri) {

        public boolean configured() {
            return notBlank(clientId) && notBlank(clientSecret) && notBlank(redirectUri);
        }

        private static boolean notBlank(String value) {
            return value != null && !value.isBlank();
        }
    }
}
