package com.ssafy.yorr.auth.application;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;

/**
 * OAuth {@code state} 보관소 — 로그인 요청을 우리가 시작했다는 증거다.
 * <p>
 * 이게 없으면 공격자가 자기 인가 코드를 담은 콜백 URL로 피해자를 유도해 <b>피해자를
 * 공격자 계정으로 로그인시킬 수 있다</b>(로그인 CSRF). 그래서 authorize에서 발급한 값만
 * 콜백에서 통과시킨다.
 * <p>
 * 한 번 쓰면 사라진다 — 같은 콜백 URL을 다시 열어도 통하지 않는다.
 */
@Component
public class OAuthStateStore {

    /** 동의 화면에서 머무는 시간을 감안한 값. 길게 둘수록 재사용 창이 넓어진다. */
    private static final Duration TTL = Duration.ofMinutes(5);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final StringRedisTemplate redis;

    public OAuthStateStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public String issue() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String state = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        redis.opsForValue().set(key(state), "1", TTL);
        return state;
    }

    /** @return 우리가 발급했고 아직 쓰이지 않은 state였는지. DEL의 반환으로 판정해 동시 요청에도 한 번만 통과한다. */
    public boolean consume(String state) {
        if (state == null || state.isBlank()) return false;
        return Boolean.TRUE.equals(redis.delete(key(state)));
    }

    private static String key(String state) {
        return "auth:oauth-state:" + state;
    }
}
