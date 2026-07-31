package com.ssafy.yorr.user.application;

import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.domain.User;
import com.ssafy.yorr.user.repository.UserRepository;
import com.ssafy.yorr.user.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 닉네임은 users 테이블과 Redis 세션 두 곳에 있다. 둘이 함께 움직이는지는 실제 저장소에서만
 * 확인된다 — 한쪽만 바뀌면 "고쳤는데 화면은 그대로"이거나 "세션이 만료되니 되돌아간다".
 */
@SpringBootTest
@Testcontainers
class UserProfileServiceIntegrationTest {

    @Container
    private static final GenericContainer<?> MYSQL =
            new GenericContainer<>(DockerImageName.parse("mysql:8.0"))
                    .withEnv("MYSQL_DATABASE", "yorr")
                    .withEnv("MYSQL_ROOT_PASSWORD", "test")
                    .withExposedPorts(3306);

    @Container
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine")).withExposedPorts(6379);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () ->
                "jdbc:mysql://" + MYSQL.getHost() + ":" + MYSQL.getFirstMappedPort() + "/yorr");
        registry.add("spring.datasource.username", () -> "root");
        registry.add("spring.datasource.password", () -> "test");
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", REDIS::getFirstMappedPort);
        registry.add("spring.docker.compose.enabled", () -> "false");
    }

    @Autowired
    private UserProfileService profileService;
    @Autowired
    private UserService userService;
    @Autowired
    private UserRepository users;

    private User member;
    private String sessionToken;

    @BeforeEach
    void signUp() {
        users.deleteAll();
        member = users.save(User.create(User.PLACEHOLDER_NICKNAME, null));
        sessionToken = userService.openMemberSession(member.getId(), member.getNickname());
    }

    @Test
    void 닉네임을_바꾸면_DB와_세션이_함께_바뀐다() {
        profileService.rename(member.getId(), "새이름");

        assertThat(users.findById(member.getId()).orElseThrow().getNickname()).isEqualTo("새이름");
        // 세션까지 바뀌어야 화면과 방 명단에 바로 반영된다.
        assertThat(userService.authenticateSession(sessionToken).nickname()).isEqualTo("새이름");
        assertThat(userService.authenticateSession(sessionToken).type()).isEqualTo(UserType.MEMBER);
    }

    /** 사용자가 직접 이름을 정했으면 그 뒤로는 로그인해도 제공자 이름으로 덮이면 안 된다. */
    @Test
    void 이름을_직접_정하면_더_이상_임시_이름이_아니다() {
        assertThat(users.findById(member.getId()).orElseThrow().hasPlaceholderNickname()).isTrue();

        profileService.rename(member.getId(), "내가정한이름");

        assertThat(users.findById(member.getId()).orElseThrow().hasPlaceholderNickname()).isFalse();
    }

    @Test
    void 빈_이름이나_너무_긴_이름은_거절한다() {
        assertThatThrownBy(() -> profileService.rename(member.getId(), "  "))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("invalid_nickname");
        assertThatThrownBy(() -> profileService.rename(member.getId(), "가".repeat(21)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("invalid_nickname");

        assertThat(users.findById(member.getId()).orElseThrow().getNickname())
                .isEqualTo(User.PLACEHOLDER_NICKNAME);
    }

    /** 세션이 이미 만료됐어도 프로필 자체는 고칠 수 있어야 한다(다음 로그인에 반영된다). */
    @Test
    void 세션이_없어도_DB_이름은_바뀐다() {
        userService.closeSession(sessionToken);

        profileService.rename(member.getId(), "세션없이바꾼이름");

        assertThat(users.findById(member.getId()).orElseThrow().getNickname())
                .isEqualTo("세션없이바꾼이름");
    }
}
