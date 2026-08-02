package com.ssafy.yorr.auth.application;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;

/**
 * 콜백에서 프론트로 넘기는 <b>일회용 교환 코드</b>.
 * <p>
 * 세션 토큰을 리다이렉트 URL에 그대로 실으면 브라우저 히스토리 · 리퍼러 · 서버 접근 로그에
 * 남는다. 대신 60초만 사는 코드를 넘기고, 프론트가 그것을 한 번 제시해 진짜 세션 토큰으로
 * 바꾼다. 유출되더라도 이미 교환된 뒤라면 쓸모가 없다.
 */
@Component
public class LoginCodeStore {

    /** 리다이렉트 직후 즉시 교환되므로 짧게 잡는다. */
    private static final Duration TTL = Duration.ofSeconds(60);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final StringRedisTemplate redis;

    public LoginCodeStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public String issue(String sessionToken) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String code = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        redis.opsForValue().set(key(code), sessionToken, TTL);
        return code;
    }

    /**
     * 코드를 세션 토큰으로 바꾼다. GETDEL이라 <b>두 번째 요청은 반드시 실패한다</b>.
     *
     * @return 세션 토큰. 없거나 이미 쓰였으면 null.
     */
    public String consume(String code) {
        if (code == null || code.isBlank()) return null;
        return redis.opsForValue().getAndDelete(key(code));
    }

    private static String key(String code) {
        return "auth:login-code:" + code;
    }
}
