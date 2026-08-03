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
 * 파티 모드의 핵심은 두 가지다 — 방을 연 대시보드는 플레이어도 방장도 아니고, 방장은 처음
 * 들어온 컨트롤러가 이어받는다. 그 이양·승계가 모두 Lua 안에 있어(JOIN·LEAVE) 조건이 어긋나도
 * 컴파일로는 잡히지 않는다 — 그걸 잡는 테스트다.
 */
@Testcontainers
class PartyRoomIntegrationTest {

    private static final String DASHBOARD = "dashboard-1";
    private static final String CONTROLLER = "phone-1";
    private static final String CONTROLLER_2 = "phone-2";

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

    /**
     * 처음 들어온 컨트롤러가 방장을 이어받는다 — 파티 모드에서 조작이 폰으로 넘어오는 지점이다.
     * 이게 깨지면 방장이 명단 밖(대시보드)을 가리켜 아무도 게임을 시작할 수 없다.
     */
    @Test
    void firstControllerBecomesHost() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);

        rooms.join(roomCode, new UserIdentity(CONTROLLER, "폰1", UserType.GUEST), "token");

        assertThat(rooms.getSnapshot(roomCode).hostId()).isEqualTo(CONTROLLER);
        bots.add(roomCode, CONTROLLER);
        assertThat(redisTemplate.opsForHash().size(RoomRedisKeys.botsKey(roomCode))).isEqualTo(1);
    }

    /** 뒤에 들어온 컨트롤러는 방장을 빼앗지 않는다 — 이양은 주인 없는 자리에만 일어난다. */
    @Test
    void laterControllerDoesNotTakeOverHost() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);
        rooms.join(roomCode, new UserIdentity(CONTROLLER, "폰1", UserType.GUEST), "token");

        rooms.join(roomCode, new UserIdentity(CONTROLLER_2, "폰2", UserType.GUEST), "token");

        assertThat(rooms.getSnapshot(roomCode).hostId()).isEqualTo(CONTROLLER);
    }

    /** 대시보드는 방장이 아니다 — TV가 조작 권한을 갖지 않아야 조작이 폰 한 곳에만 있다. */
    @Test
    void dashboardCannotOperateThePartyRoom() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);
        rooms.join(roomCode, new UserIdentity(CONTROLLER, "폰1", UserType.GUEST), "token");

        assertThatThrownBy(() -> bots.add(roomCode, DASHBOARD))
                .isInstanceOf(SecurityException.class)
                .hasMessage("host_only");
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

    /** 방장이 아닌 컨트롤러는 조작할 수 없다 — 방장이 하나여야 시작 버튼이 한 곳에만 있다. */
    @Test
    void partyRoomRejectsControllerWhoIsNotTheHost() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);
        rooms.join(roomCode, new UserIdentity(CONTROLLER, "폰1", UserType.GUEST), "token");
        rooms.join(roomCode, new UserIdentity(CONTROLLER_2, "폰2", UserType.GUEST), "token");

        assertThatThrownBy(() -> bots.add(roomCode, CONTROLLER_2))
                .isInstanceOf(SecurityException.class)
                .hasMessage("host_only");
    }

    /**
     * 방장이 나가면 남은 사람이 이어받는다. 이게 없으면 hostId가 명단 밖을 가리킨 채 굳어
     * 아무도 게임을 시작·재시작할 수 없는 방이 된다(파티 방·일반 방 공통 규약).
     */
    @Test
    void hostPassesToRemainingControllerWhenHostLeaves() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);
        rooms.join(roomCode, new UserIdentity(CONTROLLER, "폰1", UserType.GUEST), "token");
        rooms.join(roomCode, new UserIdentity(CONTROLLER_2, "폰2", UserType.GUEST), "token");

        rooms.leave(roomCode, CONTROLLER);

        assertThat(rooms.getSnapshot(roomCode).hostId()).isEqualTo(CONTROLLER_2);
        bots.add(roomCode, CONTROLLER_2);
        assertThat(redisTemplate.opsForHash().size(RoomRedisKeys.botsKey(roomCode))).isEqualTo(1);
    }

    /** 일반 방에서도 같다 — 방장이 나가도 남은 사람이 게임을 다시 시작할 수 있어야 한다. */
    @Test
    void normalRoomPassesHostToRemainingPlayer() {
        String roomCode = creates.createRoom(6, CONTROLLER, "YACHT_DICE");
        rooms.join(roomCode, new UserIdentity(CONTROLLER, "폰1", UserType.GUEST), "token");
        rooms.join(roomCode, new UserIdentity(CONTROLLER_2, "폰2", UserType.GUEST), "token");

        rooms.leave(roomCode, CONTROLLER);

        assertThat(rooms.getSnapshot(roomCode).hostId()).isEqualTo(CONTROLLER_2);
    }

    /** 봇은 방장이 될 수 없다 — 봇에게 넘기면 아무도 조작할 수 없는 것과 같다. */
    @Test
    void botsAreNotEligibleToInheritHost() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);
        rooms.join(roomCode, new UserIdentity(CONTROLLER, "폰1", UserType.GUEST), "token");
        bots.add(roomCode, CONTROLLER);

        rooms.leave(roomCode, CONTROLLER);

        assertThat(rooms.getSnapshot(roomCode).players()).hasSize(1);
        assertThat(rooms.getSnapshot(roomCode).hostId()).isEmpty();
    }

    /**
     * 사람이 다 빠지면 방장 자리는 비고, 다음에 들어온 컨트롤러가 이어받는다 — 파티 방은
     * 사람이 0명이어도 살아 있으므로(QR 대기) 여기서 막히면 방이 영구히 잠긴다.
     */
    @Test
    void emptiedHostSeatIsClaimedByTheNextController() {
        String roomCode = creates.createRoom(6, DASHBOARD, "YACHT_DICE", RoomMode.PARTY);
        rooms.join(roomCode, new UserIdentity(CONTROLLER, "폰1", UserType.GUEST), "token");
        rooms.leave(roomCode, CONTROLLER);
        assertThat(rooms.getSnapshot(roomCode).hostId()).isEmpty();

        rooms.join(roomCode, new UserIdentity(CONTROLLER_2, "폰2", UserType.GUEST), "token");

        assertThat(rooms.getSnapshot(roomCode).hostId()).isEqualTo(CONTROLLER_2);
    }
}
