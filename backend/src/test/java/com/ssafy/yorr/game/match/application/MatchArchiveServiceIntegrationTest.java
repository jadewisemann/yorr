package com.ssafy.yorr.game.match.application;

import com.ssafy.yorr.game.match.domain.Match;
import com.ssafy.yorr.game.match.domain.MatchParticipant;
import com.ssafy.yorr.game.match.repository.MatchRepository;
import com.ssafy.yorr.game.pingpong.PingPongAiResultRequest;
import com.ssafy.yorr.game.pingpong.PingPongAiResultService;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomPlayerSnapshot;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.user.domain.User;
import com.ssafy.yorr.user.repository.UserRepository;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.ws.dto.GameOverPayload;
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

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 결과 적재는 스키마·제약과 함께 움직인다(game_id UNIQUE, user_id nullable + FK).
 * 그 합은 실제 MySQL에서만 확인된다.
 */
@SpringBootTest
@Testcontainers
class MatchArchiveServiceIntegrationTest {

    private static final String GAME_ID = "game-1";

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
    private MatchArchiveService service;
    @Autowired
    private PingPongAiResultService pingPongAiResults;
    @Autowired
    private MatchRepository matches;
    @Autowired
    private UserRepository users;

    @BeforeEach
    void clear() {
        matches.deleteAll();
        users.deleteAll();
    }

    private static RoomSnapshot room(List<RoomPlayerSnapshot> players) {
        return new RoomSnapshot("ROOM01", "YACHT_DICE", GAME_ID, "member-1", RoomPhase.FINISHED, 6, players);
    }

    /**
     * 회원과 게스트가 한 판에 섞여 있다. 판 자체는 온전히 남고, 주인이 있는 행에만 계정이 붙는다.
     */
    @Test
    void 회원은_계정에_게스트는_이름만_남는다() {
        User member = users.save(User.create("카카오회원", null));
        RoomSnapshot room = room(List.of(
                new RoomPlayerSnapshot(member.getId(), "방에서쓴이름", 0),
                new RoomPlayerSnapshot("guest-1", "지나가던손님", 0)));

        boolean saved = service.archive(room, List.of(
                new GameOverPayload.Ranking(1, member.getId(), 210),
                new GameOverPayload.Ranking(2, "guest-1", 180)));

        assertThat(saved).isTrue();
        Match stored = matches.findWithParticipantsByGameId(GAME_ID).orElseThrow();
        assertThat(stored.getGameId()).isEqualTo(GAME_ID);
        assertThat(stored.getPlayerCount()).isEqualTo(2);

        List<MatchParticipant> participants = stored.getParticipants();
        assertThat(participants).hasSize(2);
        MatchParticipant first = participants.getFirst();
        assertThat(first.getUser().getId()).isEqualTo(member.getId());
        assertThat(first.getTotalScore()).isEqualTo(210);
        assertThat(first.getRanking()).isEqualTo(1);
        // 그때 화면에 보였던 이름이어야 한다 — 프로필 닉네임이 아니라 방에서 쓴 이름이다.
        assertThat(first.getDisplayNickname()).isEqualTo("방에서쓴이름");
        assertThat(participants.get(1).getUser()).isNull();
        assertThat(participants.get(1).getDisplayNickname()).isEqualTo("지나가던손님");
    }

    /** 종료 방송이 두 번 일어나도 같은 판이 두 번 쌓이면 안 된다. */
    @Test
    void 같은_게임은_한_번만_저장된다() {
        RoomSnapshot room = room(List.of(new RoomPlayerSnapshot("guest-1", "손님", 0)));
        List<GameOverPayload.Ranking> rankings = List.of(new GameOverPayload.Ranking(1, "guest-1", 100));

        assertThat(service.archive(room, rankings)).isTrue();
        assertThat(service.archive(room, rankings)).isFalse();

        assertThat(matches.count()).isEqualTo(1);
    }

    /** 저장할 것이 없는 호출은 빈 판을 만들지 않는다. */
    @Test
    void 순위가_비었으면_저장하지_않는다() {
        assertThat(service.archive(room(List.of()), List.of())).isFalse();
        assertThat(matches.count()).isZero();
    }

    /**
     * 닉네임을 방 스냅샷에서 못 찾는 경우가 있다 — 게임이 끝나기 전에 나간 사람이다.
     * 그래도 회원이면 프로필 이름으로, 아니면 식별자로라도 남긴다.
     */
    @Test
    void 방에_없는_참가자도_이름을_찾아_남긴다() {
        User member = users.save(User.create("떠난회원", null));

        service.archive(room(List.of()), List.of(
                new GameOverPayload.Ranking(1, member.getId(), 150),
                new GameOverPayload.Ranking(2, "guest-gone", 90)));

        List<MatchParticipant> participants =
                matches.findWithParticipantsByGameId(GAME_ID).orElseThrow().getParticipants();
        assertThat(participants.getFirst().getDisplayNickname()).isEqualTo("떠난회원");
        assertThat(participants.get(1).getDisplayNickname()).isEqualTo("guest-gone");
    }

    @Test
    void 로컬_AI_탁구는_사람과_AI의_최종_점수를_함께_저장한다() {
        User member = users.save(User.create("탁구회원", null));
        String resultId = "1d61e930-cbea-41f3-935d-85fb95919e44";

        assertThat(pingPongAiResults.archive(
                new UserIdentity(member.getId(), member.getNickname(), UserType.MEMBER),
                new PingPongAiResultRequest(resultId, 11, 7))).isTrue();

        Match stored = matches.findWithParticipantsByGameId(resultId).orElseThrow();
        assertThat(stored.getGameCode()).isEqualTo("PING_PONG");
        assertThat(stored.getRoomCode()).isEqualTo("LOCAL_AI");
        assertThat(stored.getPlayerCount()).isEqualTo(2);
        assertThat(stored.getParticipants())
                .extracting(MatchParticipant::getPlayerId, MatchParticipant::getTotalScore,
                        MatchParticipant::getRanking)
                .containsExactlyInAnyOrder(
                        org.assertj.core.api.Assertions.tuple(member.getId(), 11, 1),
                        org.assertj.core.api.Assertions.tuple("ping-pong-ai", 7, 2));
        MatchParticipant human = stored.getParticipants().stream()
                .filter(participant -> participant.getPlayerId().equals(member.getId()))
                .findFirst().orElseThrow();
        MatchParticipant ai = stored.getParticipants().stream()
                .filter(participant -> participant.getPlayerId().equals("ping-pong-ai"))
                .findFirst().orElseThrow();
        assertThat(human.getUser()).isNotNull();
        assertThat(ai.getUser()).isNull();
    }

    @Test
    void 같은_로컬_AI_결과를_재전송해도_한_번만_저장한다() {
        User member = users.save(User.create("탁구회원", null));
        UserIdentity identity = new UserIdentity(member.getId(), member.getNickname(), UserType.MEMBER);
        PingPongAiResultRequest result = new PingPongAiResultRequest(
                "32a17150-a1f3-4aed-ab59-11ac95665833", 8, 11);

        assertThat(pingPongAiResults.archive(identity, result)).isTrue();
        assertThat(pingPongAiResults.archive(identity, result)).isFalse();
        assertThat(matches.count()).isEqualTo(1);
    }

    @Test
    void 로컬_AI_탁구_게스트는_user_없이_UUID와_점수를_저장한다() {
        String resultId = "7f7b50af-a2ec-47b6-93e6-6a54046d8ad0";

        assertThat(pingPongAiResults.archiveGuest(
                new PingPongAiResultRequest(resultId, 11, 4))).isTrue();

        Match stored = matches.findWithParticipantsByGameId(resultId).orElseThrow();
        MatchParticipant guest = stored.getParticipants().stream()
                .filter(participant -> !participant.getPlayerId().equals("ping-pong-ai"))
                .findFirst().orElseThrow();
        assertThat(stored.getGameCode()).isEqualTo("PING_PONG");
        assertThat(stored.getRoomCode()).isEqualTo("LOCAL_AI");
        assertThat(guest.getUser()).isNull();
        assertThat(guest.getPlayerId()).matches(
                "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
        assertThat(guest.getDisplayNickname()).isEqualTo("게스트");
        assertThat(guest.getTotalScore()).isEqualTo(11);
        assertThat(guest.getRanking()).isEqualTo(1);
    }
}
