package com.ssafy.yorr.game.ranking;

import com.ssafy.yorr.config.CacheConfig;
import com.ssafy.yorr.game.match.application.MatchArchiveService;
import com.ssafy.yorr.game.match.domain.Match;
import com.ssafy.yorr.game.match.domain.MatchParticipant;
import com.ssafy.yorr.game.match.repository.MatchParticipantRepository;
import com.ssafy.yorr.game.match.repository.MatchParticipantRepository.WeeklyBest;
import com.ssafy.yorr.game.match.repository.MatchRepository;
import com.ssafy.yorr.game.ranking.application.WeeklyRankingService.WeeklyRanking;
import com.ssafy.yorr.game.ranking.controller.dto.WeeklyRankingResponse;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomPlayerSnapshot;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.user.domain.User;
import com.ssafy.yorr.user.repository.UserRepository;
import com.ssafy.yorr.ws.dto.GameOverPayload;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cache.CacheManager;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.LocalDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

/**
 * 주간 집계 질의는 스키마와 함께 움직인다 — user_id nullable(게스트)과 users 조인, GROUP BY의
 * 합이 맞아야 한다. 그 합은 실제 MySQL에서만 확인된다.
 * <p>
 * 시각은 {@code finished_at}과 같은 기준(UTC 벽시계)으로 직접 넣는다. KST 환산은
 * {@code WeeklyRankingServiceTest}가 따로 본다.
 */
@SpringBootTest
@Testcontainers
class WeeklyRankingQueryIntegrationTest {

    /** 2026-08-03(월) 00:00 KST == 2026-08-02(일) 15:00 UTC */
    private static final LocalDateTime FROM = LocalDateTime.parse("2026-08-02T15:00");
    private static final LocalDateTime TO = LocalDateTime.parse("2026-08-09T15:00");

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
    private MatchParticipantRepository participants;
    @Autowired
    private MatchRepository matches;
    @Autowired
    private UserRepository users;
    @Autowired
    private MatchArchiveService archiveService;
    @Autowired
    private CacheManager caches;

    /**
     * 캐시도 함께 비운다. 항목마다 같은 주를 묻는데 캐시는 컨텍스트에 공유되므로, DB만
     * 지우면 앞 항목의 결과가 다음 항목으로 흘러간다.
     */
    @BeforeEach
    void clear() {
        matches.deleteAll();
        users.deleteAll();
        caches.getCache(CacheConfig.WEEKLY_RANKING).clear();
    }

    private List<WeeklyBest> weeklyBest() {
        return participants.findWeeklyBest(FROM, TO, PageRequest.of(0, 100));
    }

    /** 참가자 하나로 이루어진 판. 점수 외의 값은 이 질의가 보지 않으므로 최소한만 채운다. */
    private void saveMatch(String gameId, LocalDateTime finishedAt,
                           User user, String displayNickname, int score) {
        Match match = Match.finished(gameId, "YACHT_DICE", "ROOM01", finishedAt);
        match.add(MatchParticipant.of(user, user == null ? "guest-" + gameId : user.getId(),
                displayNickname, score, 1));
        matches.save(match);
    }

    /**
     * 게스트에게는 계정이 없으므로 랭킹에 오를 자리도 없다 — 점수가 아무리 높아도 빠진다.
     * 이 경계가 곧 로그인할 이유다.
     */
    @Test
    void 게스트는_점수가_높아도_집계에서_빠진다() {
        User member = users.save(User.create("회원", null));
        saveMatch("g-member", FROM, member, "회원", 200);
        saveMatch("g-guest", FROM, null, "손님", 900);

        assertThat(weeklyBest())
                .extracting(WeeklyBest::getUserId, WeeklyBest::getBestScore)
                .containsExactly(tuple(member.getId(), 200));
    }

    /** 주간 최고점은 누적이 아니라 <b>한 판의 최댓값</b>이다. */
    @Test
    void 여러_판을_해도_한_판_최고점만_센다() {
        User member = users.save(User.create("회원", null));
        saveMatch("g-1", FROM, member, "회원", 200);
        saveMatch("g-2", FROM.plusDays(1), member, "회원", 320);
        saveMatch("g-3", FROM.plusDays(2), member, "회원", 180);

        assertThat(weeklyBest())
                .extracting(WeeklyBest::getBestScore)
                .containsExactly(320);
    }

    /** 시작은 포함, 끝은 제외다. 경계를 잘못 잡으면 한 판이 두 주에 세어진다. */
    @Test
    void 기간_밖의_판은_세지_않는다() {
        User member = users.save(User.create("회원", null));
        saveMatch("g-before", FROM.minusNanos(1000), member, "회원", 900);
        saveMatch("g-start", FROM, member, "회원", 100);
        saveMatch("g-end", TO, member, "회원", 800);

        assertThat(weeklyBest())
                .extracting(WeeklyBest::getBestScore)
                .containsExactly(100);
    }

    /**
     * 닉네임은 <b>현재 프로필 이름</b>이어야 한다. {@code display_nickname}은 그때 그 화면에
     * 보였던 이름이라, 이름을 바꾼 회원이 랭킹에서 옛 이름으로 보이면 안 된다.
     */
    @Test
    void 닉네임은_지난_판의_표시_이름이_아니라_현재_프로필_이름이다() {
        User member = users.save(User.create("바꾼이름", null));
        saveMatch("g-1", FROM, member, "그때쓴이름", 200);

        assertThat(weeklyBest())
                .extracting(WeeklyBest::getNickname)
                .containsExactly("바꾼이름");
    }

    @Test
    void 점수_내림차순으로_나온다() {
        User low = users.save(User.create("하위", null));
        User high = users.save(User.create("상위", null));
        saveMatch("g-low", FROM, low, "하위", 100);
        saveMatch("g-high", FROM, high, "상위", 300);

        assertThat(weeklyBest())
                .extracting(WeeklyBest::getNickname)
                .containsExactly("상위", "하위");
    }

    /**
     * 내 순위는 "나보다 점수가 높은 회원 수 + 1"이다. 동점자는 같은 번호를 받으므로 목록에
     * 적히는 번호와 반드시 일치해야 한다 — 두 값이 갈리면 같은 사람이 화면 두 곳에서 다른
     * 순위로 보인다.
     */
    @Test
    void 내_순위는_목록에_적히는_번호와_같다() {
        User top = users.save(User.create("일등", null));
        User tieA = users.save(User.create("공동이등가", null));
        User tieB = users.save(User.create("공동이등나", null));
        User me = users.save(User.create("나", null));
        saveMatch("g-top", FROM, top, "일등", 300);
        saveMatch("g-tie-a", FROM, tieA, "공동이등가", 250);
        saveMatch("g-tie-b", FROM, tieB, "공동이등나", 250);
        saveMatch("g-me", FROM, me, "나", 100);

        var entries = WeeklyRankingResponse
                .of(new WeeklyRanking(FROM.toLocalDate(), weeklyBest()))
                .entries();

        // 번호는 1, 2, 2, 4다. 동점자 둘의 앞뒤는 user_id(UUID) 순이라 삽입 순서와 무관하므로
        // 이름까지 순서로 못 박지 않는다 — 여기서 보려는 것은 번호 체계다.
        assertThat(entries).extracting(WeeklyRankingResponse.Entry::rank)
                .containsExactly(1, 2, 2, 4);
        assertThat(entries)
                .extracting(WeeklyRankingResponse.Entry::nickname, WeeklyRankingResponse.Entry::rank)
                .containsExactlyInAnyOrder(tuple("일등", 1), tuple("공동이등가", 2),
                        tuple("공동이등나", 2), tuple("나", 4));

        assertThat(participants.findWeeklyBestScoreOf(me.getId(), FROM, TO)).isEqualTo(100);
        assertThat(participants.countMembersScoringMoreThan(100, FROM, TO) + 1).isEqualTo(4);
    }

    /** 여러 판을 했으면 그중 최고점이 내 점수다 — 마지막 판이 아니다. */
    @Test
    void 내_최고점은_여러_판_중_최댓값이다() {
        User me = users.save(User.create("나", null));
        saveMatch("g-1", FROM, me, "나", 120);
        saveMatch("g-2", FROM.plusDays(1), me, "나", 260);
        saveMatch("g-3", FROM.plusDays(2), me, "나", 80);

        assertThat(participants.findWeeklyBestScoreOf(me.getId(), FROM, TO)).isEqualTo(260);
    }

    /** 기록 없음은 0점과 다르다 — null이어야 "오를 자리가 없다"를 표현할 수 있다. */
    @Test
    void 이번_주_기록이_없으면_최고점이_null이다() {
        User me = users.save(User.create("나", null));
        saveMatch("g-last-week", FROM.minusDays(3), me, "나", 500);

        assertThat(participants.findWeeklyBestScoreOf(me.getId(), FROM, TO)).isNull();
    }

    /**
     * 집계는 판이 끝날 때만 바뀌므로 그 사이 요청은 캐시가 답한다. 판을 우회해 리포지토리로
     * 직접 넣은 행이 보이지 않는 것이 캐시가 실제로 걸려 있다는 증거다.
     */
    @Test
    void 같은_주를_다시_물으면_캐시가_답한다() {
        User member = users.save(User.create("회원", null));
        saveMatch("g-1", FROM, member, "회원", 200);
        assertThat(weeklyBest()).extracting(WeeklyBest::getBestScore).containsExactly(200);

        saveMatch("g-2", FROM, member, "회원", 500);

        assertThat(weeklyBest()).extracting(WeeklyBest::getBestScore).containsExactly(200);
    }

    /** 판이 끝나면 캐시를 비운다 — 그 뒤 조회는 새 결과를 본다. */
    @Test
    void 판이_끝나면_캐시가_비워진다() {
        User member = users.save(User.create("회원", null));
        saveMatch("g-1", FROM, member, "회원", 200);
        weeklyBest();

        saveMatch("g-2", FROM, member, "회원", 500);
        archiveService.archive(
                new RoomSnapshot("ROOM01", "YACHT_DICE", "g-archived", "host", RoomPhase.FINISHED, 6,
                        List.of(new RoomPlayerSnapshot("host", "호스트", 0))),
                List.of(new GameOverPayload.Ranking(1, member.getId(), 10)));

        assertThat(weeklyBest()).extracting(WeeklyBest::getBestScore).containsExactly(500);
    }
}
