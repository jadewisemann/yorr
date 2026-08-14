package com.ssafy.yorr.user.service;

import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.UserType;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 세션 수명은 Redis 키 두 개(user:{id} 해시 · user:token:{hash} 역인덱스)의 합이라,
 * 둘이 함께 움직이는지는 실제 Redis에서만 확인된다.
 */
@Testcontainers
class UserServiceSessionIntegrationTest {

    @Container
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine")).withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redisTemplate;
    private static UserService userService;

    @BeforeAll
    static void startRedis() {
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        connectionFactory.afterPropertiesSet();
        redisTemplate = new StringRedisTemplate(connectionFactory);
        redisTemplate.afterPropertiesSet();
        userService = new UserService(redisTemplate);
    }

    @AfterAll
    static void stopRedis() {
        connectionFactory.destroy();
    }

    @BeforeEach
    void clear() {
        redisTemplate.getConnectionFactory().getConnection().serverCommands().flushAll();
    }

    @Test
    void 회원_세션은_토큰으로도_아이디로도_인증된다() {
        String token = userService.openMemberSession("member-1", "카카오회원");

        assertThat(userService.authenticateSession(token).type()).isEqualTo(UserType.MEMBER);
        assertThat(userService.authenticate("member-1", "Bearer " + token).nickname())
                .isEqualTo("카카오회원");
    }

    /**
     * 로그아웃은 역인덱스만 지우면 부족하다 — 그것만으로는 WebSocket 경로만 막히고,
     * userId + Bearer를 직접 쓰는 REST 경로는 그대로 통과한다.
     */
    @Test
    void 로그아웃하면_두_경로_모두_막힌다() {
        String token = userService.openMemberSession("member-1", "카카오회원");

        userService.closeSession(token);

        assertThatThrownBy(() -> userService.authenticateSession(token))
                .isInstanceOf(SessionAuthenticationException.class);
        assertThatThrownBy(() -> userService.authenticate("member-1", "Bearer " + token))
                .isInstanceOf(SessionAuthenticationException.class);
    }

    /** 클라이언트는 어차피 로컬을 지운다. 이미 없는 세션을 닫는다고 실패를 알릴 이유가 없다. */
    @Test
    void 없는_세션을_닫아도_조용히_성공한다() {
        userService.closeSession("never-issued");
        userService.closeSession(null);
        userService.closeSession("");
    }

    /** 다시 로그인하면 이전 토큰은 살아 있으면 안 된다 — tokenHash가 덮어써지기 때문이다. */
    @Test
    void 다시_로그인하면_이전_토큰이_무효화된다() {
        String first = userService.openMemberSession("member-1", "카카오회원");
        String second = userService.openMemberSession("member-1", "카카오회원");

        assertThat(userService.authenticateSession(second).userId()).isEqualTo("member-1");
        assertThatThrownBy(() -> userService.authenticateSession(first))
                .isInstanceOf(SessionAuthenticationException.class);
    }

    /** 게스트 세션을 회원 수명으로 늘리면 안 된다 — 24시간과 30일은 정책이 다르다. */
    @Test
    void 게스트와_회원의_수명이_다르다() {
        var guest = userService.createGuest("게스트");
        String memberToken = userService.openMemberSession("member-1", "카카오회원");

        Long guestTtl = redisTemplate.getExpire("user:" + guest.userId());
        Long memberTtl = redisTemplate.getExpire("user:member-1");

        assertThat(guestTtl).isLessThanOrEqualTo(24 * 60 * 60);
        assertThat(memberTtl).isGreaterThan(24 * 60 * 60);
        assertThat(userService.authenticateSession(memberToken).type()).isEqualTo(UserType.MEMBER);
    }
}
