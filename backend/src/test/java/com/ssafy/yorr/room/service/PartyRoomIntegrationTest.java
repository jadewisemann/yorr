package com.ssafy.yorr.room.service;

import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.dto.RoomMode;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 파티 방(대시보드)의 전제를 실제 Redis에서 확인한다.
 * <p>
 * 파티 모드의 핵심은 "방을 연 사람이 플레이어 명단에 없다"는 것이고, 그 위에서 호스트 조작이
 * 계속 통해야 한다. 호스트 검사는 Lua 안에 있어(BotParticipantService) 조건이 어긋나도
 * 컴파일로는 잡히지 않는다 — 그걸 잡는 테스트다.
 */
@Testcontainers
class PartyRoomIntegrationTest {

    private static final String DASHBOARD = "dashboard-1";
    private static final String CONTROLLER = "phone-1";

    @Container
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine"))
                    .withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redisTemplate;
    private static RoomCreateService creates;
    private static RoomValidationService rooms;
    private static BotParticipantService bots;

    @BeforeAll
    static void connectRedis() {
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getFirstMappedPort());
        connectionFactory.afterPropertiesSet();
        redisTemplate = new StringRedisTemplate(connectionFactory);
        redisTemplate.afterPropertiesSet();
        creates = new RoomCreateService(redisTemplate);
        rooms = new RoomValidationService(redisTemplate);
        bots = new BotParticipantService(redisTemplate, rooms);
    }

    @AfterAll
    static void disconnectRedis() {
        if (connectionFactory != null) {
            connectionFactory.destroy();
        }
    }

    @BeforeEach
    void resetRedis() {
        try (RedisConnection connection = redisTemplate.getConnectionFactory().getConnection()) {
            connection.serverCommands().flushAll();
        }
    }

    /** 대시보드는 방을 열되 플레이어가 아니다 — 명단이 비어 있어야 턴 순서·점수판이 컨트롤러만의 것이 된다. */
    @Test
    void partyRoomStartsWithNoPlayers() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);

        assertThat(rooms.isPartyRoom(roomCode)).isTrue();
        assertThat(rooms.getSnapshot(roomCode).players()).isEmpty();
        assertThat(rooms.getSnapshot(roomCode).hostId()).isEqualTo(DASHBOARD);
    }

    @Test
    void normalRoomIsNotAPartyRoom() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE");

        assertThat(rooms.isPartyRoom(roomCode)).isFalse();
    }

    /** 명단에 없는 방을 없는 방으로 착각하지 않는다 — mode를 못 읽으면 여기서 무너진다. */
    @Test
    void controllerJoinsPartyRoomAsTheOnlyPlayer() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);

        rooms.join(roomCode, new UserIdentity(CONTROLLER, "폰1", UserType.GUEST), "token");

        assertThat(rooms.getSnapshot(roomCode).players())
                .singleElement()
                .satisfies(player -> assertThat(player.playerId()).isEqualTo(CONTROLLER));
    }

    /** 파티 방의 대시보드는 명단에 없어도 봇을 붙일 수 있다(호스트 검사에서 명단 조건을 뺀 경로). */
    @Test
    void dashboardCanAddBotWithoutBeingAPlayer() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);

        bots.add(roomCode, DASHBOARD);

        assertThat(rooms.getSnapshot(roomCode).players()).hasSize(1);
        assertThat(redisTemplate.opsForHash().size(RoomRedisKeys.botsKey(roomCode))).isEqualTo(1);
    }

    /** 일반 방에서는 명단 조건이 그대로 살아 있어야 한다 — 떠난 옛 호스트가 조작하지 못하게. */
    @Test
    void normalRoomStillRequiresHostToBeAPlayer() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE");

        assertThatThrownBy(() -> bots.add(roomCode, DASHBOARD))
                .isInstanceOf(SecurityException.class)
                .hasMessage("host_only");
    }

    /**
     * 마지막 컨트롤러가 나가도 파티 방은 남는다 — 대시보드는 members에 세어지지 않으므로,
     * 일반 방과 같이 처리하면 QR을 띄운 채 기다리던 방이 발밑에서 사라진다.
     */
    @Test
    void partyRoomSurvivesTheLastControllerLeaving() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);
        rooms.join(roomCode, new UserIdentity(CONTROLLER, "폰1", UserType.GUEST), "token");

        assertThat(rooms.leave(roomCode, CONTROLLER)).isTrue();

        assertThat(rooms.getSnapshot(roomCode).phase()).isNotNull();
        assertThat(rooms.getSnapshot(roomCode).players()).isEmpty();
        assertThat(rooms.isPartyRoom(roomCode)).isTrue();
    }

    /** 일반 방은 종전대로 마지막 참가자가 나가면 사라진다. */
    @Test
    void normalRoomDiesWithTheLastPlayer() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE");
        rooms.join(roomCode, new UserIdentity(DASHBOARD, "호스트", UserType.GUEST), "token");

        rooms.leave(roomCode, DASHBOARD);

        assertThat(rooms.getSnapshot(roomCode).phase()).isNull();
    }

    /** 파티 방에서도 남이 조작하는 건 막는다 — 완화한 건 명단 조건뿐, hostId 일치는 그대로다. */
    @Test
    void partyRoomStillRejectsNonHost() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);
        rooms.join(roomCode, new UserIdentity(CONTROLLER, "폰1", UserType.GUEST), "token");

        assertThatThrownBy(() -> bots.add(roomCode, CONTROLLER))
                .isInstanceOf(SecurityException.class)
                .hasMessage("host_only");
    }
}
