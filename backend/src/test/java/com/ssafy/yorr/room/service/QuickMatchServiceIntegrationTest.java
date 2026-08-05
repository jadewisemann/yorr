package com.ssafy.yorr.room.service;

import com.ssafy.yorr.game.module.GameLifecycleService;
import com.ssafy.yorr.game.module.GameModule;
import com.ssafy.yorr.game.module.GameModuleRegistry;
import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.dto.QuickMatchResponse;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.socket.WebSocketSession;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@Testcontainers
class QuickMatchServiceIntegrationTest {

    @Container
    private static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine")).withExposedPorts(6379);

    private static LettuceConnectionFactory connectionFactory;
    private static StringRedisTemplate redis;
    private QuickMatchService matches;
    private RoomSessionRegistry sessions;
    private GameLifecycleService games;
    private GameModuleRegistry gameModules;
    private UserService users;
    private RoomValidationService rooms;

    @BeforeAll
    static void connectRedis() {
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getFirstMappedPort());
        connectionFactory.afterPropertiesSet();
        redis = new StringRedisTemplate(connectionFactory);
        redis.afterPropertiesSet();
    }

    @AfterAll
    static void disconnectRedis() {
        if (connectionFactory != null) connectionFactory.destroy();
    }

    @BeforeEach
    void setUp() {
        try (RedisConnection connection = redis.getConnectionFactory().getConnection()) {
            connection.serverCommands().flushAll();
        }
        RoomCreateService roomCreates = new RoomCreateService(redis);
        rooms = new RoomValidationService(redis);
        sessions = new RoomSessionRegistry();
        games = mock(GameLifecycleService.class);
        users = new UserService(redis);
        gameModules = mock(GameModuleRegistry.class);
        when(gameModules.require(org.mockito.ArgumentMatchers.anyString())).thenAnswer(invocation -> {
            GameModule module = mock(GameModule.class);
            when(module.minPlayers()).thenReturn(2);
            when(module.maxPlayers()).thenReturn(2);
            return module;
        });
        matches = new QuickMatchService(
                redis,
                roomCreates,
                rooms,
                users,
                sessions,
                games,
                gameModules
        );
    }

    @ParameterizedTest
    @ValueSource(strings = {"YACHT_DICE", "PING_PONG", "DUEL"})
    void matchesTwoWaitingPlayersIntoTheSameGameRoom(String gameCode) {
        UserIdentity first = user("player-a", "A");
        UserIdentity second = user("player-b", "B");

        assertThat(matches.enter(first, gameCode).status()).isEqualTo(QuickMatchResponse.Status.WAITING);
        QuickMatchResponse secondResult = matches.enter(second, gameCode);
        QuickMatchResponse firstResult = matches.status(first.userId());

        assertThat(secondResult.status()).isEqualTo(QuickMatchResponse.Status.MATCHED);
        assertThat(firstResult.roomId()).isEqualTo(secondResult.roomId());
        assertThat(new RoomValidationService(redis).getSnapshot(firstResult.roomId()))
                .satisfies(room -> {
                    assertThat(room.gameCode()).isEqualTo(gameCode);
                    assertThat(room.players()).hasSize(2);
                });
    }

    @Test
    void keepsDifferentGamesInSeparateQueues() {
        UserIdentity yachtPlayer = user("player-a", "A");
        UserIdentity pingPongPlayer = user("player-b", "B");

        assertThat(matches.enter(yachtPlayer, "YACHT_DICE").status())
                .isEqualTo(QuickMatchResponse.Status.WAITING);
        assertThat(matches.enter(pingPongPlayer, "PING_PONG").status())
                .isEqualTo(QuickMatchResponse.Status.WAITING);
    }

    @Test
    void usesNewGameModulePlayerLimitsWithoutQuickMatchChanges() {
        GameModule threePlayerGame = mock(GameModule.class);
        when(threePlayerGame.minPlayers()).thenReturn(3);
        when(threePlayerGame.maxPlayers()).thenReturn(4);
        when(gameModules.require("NEW_GAME")).thenReturn(threePlayerGame);

        assertThat(matches.enter(user("player-a", "A"), "NEW_GAME").status())
                .isEqualTo(QuickMatchResponse.Status.WAITING);
        assertThat(matches.enter(user("player-b", "B"), "NEW_GAME").status())
                .isEqualTo(QuickMatchResponse.Status.WAITING);
        QuickMatchResponse result = matches.enter(user("player-c", "C"), "NEW_GAME");

        assertThat(result.status()).isEqualTo(QuickMatchResponse.Status.MATCHED);
        assertThat(new RoomValidationService(redis).getSnapshot(result.roomId()).players()).hasSize(3);
    }

    @Test
    void waitingPlayerCanCancel() {
        UserIdentity player = user("player-a", "A");
        matches.enter(player, "YACHT_DICE");

        assertThat(matches.cancel(player.userId()).status()).isEqualTo(QuickMatchResponse.Status.NOT_QUEUED);
        assertThat(matches.status(player.userId()).status()).isEqualTo(QuickMatchResponse.Status.NOT_QUEUED);
    }

    @Test
    void leavingRoomClearsThePreviousMatchTicket() {
        UserIdentity first = user("player-a", "A");
        UserIdentity second = user("player-b", "B");
        matches.enter(first, "YACHT_DICE");
        matches.enter(second, "YACHT_DICE");

        users.clearRoom(first.userId());

        assertThat(matches.status(first.userId()).status()).isEqualTo(QuickMatchResponse.Status.NOT_QUEUED);
    }

    @Test
    void reportingPlayingClearsThePreviousMatchTicket() {
        UserIdentity first = user("player-a", "A");
        UserIdentity second = user("player-b", "B");
        matches.enter(first, "YACHT_DICE");
        String roomId = matches.enter(second, "YACHT_DICE").roomId();
        rooms.startGame(roomId, 2);

        assertThat(matches.status(first.userId()).status()).isEqualTo(QuickMatchResponse.Status.PLAYING);
        assertThat(matches.status(first.userId()).status()).isEqualTo(QuickMatchResponse.Status.NOT_QUEUED);
    }

    @Test
    void finishedPreviousMatchDoesNotBlockANewMatch() {
        UserIdentity first = user("player-a", "A");
        UserIdentity second = user("player-b", "B");
        matches.enter(first, "YACHT_DICE");
        String oldRoomId = matches.enter(second, "YACHT_DICE").roomId();
        redis.opsForHash().put(RoomRedisKeys.roomKey(oldRoomId), "phase", "FINISHED");

        assertThat(matches.enter(first, "YACHT_DICE").status()).isEqualTo(QuickMatchResponse.Status.WAITING);
        assertThat(rooms.getSnapshot(oldRoomId).players())
                .noneMatch(player -> player.playerId().equals(first.userId()));
    }

    @Test
    void startsOnlyAfterBothMatchedPlayersConnectTheirWebSockets() {
        UserIdentity first = user("player-a", "A");
        UserIdentity second = user("player-b", "B");
        matches.enter(first, "YACHT_DICE");
        String roomId = matches.enter(second, "YACHT_DICE").roomId();
        WebSocketSession firstSession = openSession("session-a");
        WebSocketSession secondSession = openSession("session-b");
        sessions.join(roomId, firstSession, first.userId(), first.nickname());

        matches.status(first.userId());
        org.mockito.Mockito.verifyNoInteractions(games);

        sessions.join(roomId, secondSession, second.userId(), second.nickname());
        matches.status(first.userId());

        verify(games).start(roomId);
    }

    private static UserIdentity user(String id, String nickname) {
        redis.opsForHash().putAll("user:" + id, Map.of("nickname", nickname, "type", UserType.GUEST.name()));
        return new UserIdentity(id, nickname, UserType.GUEST);
    }

    private static WebSocketSession openSession(String id) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        when(session.isOpen()).thenReturn(true);
        return session;
    }
}
