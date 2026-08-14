package com.ssafy.yorr.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * 브라우저에서 이 서버를 부를 수 있는 출처 목록.
 * <p>
 * 목록을 코드가 아니라 설정에 두는 이유가 둘 있다. 하나는 REST와 WebSocket이 <b>같은 값을
 * 써야 하는데</b> 두 곳에 복사해 두면 한쪽만 고치는 순간 어긋나기 때문이고, 다른 하나는
 * 개발용 출처(localhost)가 운영 배포에 섞여 들어가면 안 되기 때문이다.
 * <p>
 * 기본값은 <b>운영 도메인만</b>이다 — 환경변수를 깜빡했을 때 안전한 쪽으로 실패해야 한다.
 * 로컬 개발자는 각자 {@code .env}에서 localhost를 덧붙인다.
 */
@ConfigurationProperties(prefix = "yorr.cors")
public record CorsProperties(List<String> allowedOrigins) {

    public CorsProperties {
        allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
    }

    public String[] originsArray() {
        return allowedOrigins.toArray(String[]::new);
    }
}
