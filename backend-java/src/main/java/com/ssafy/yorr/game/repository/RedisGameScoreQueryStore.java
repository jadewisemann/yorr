package com.ssafy.yorr.game.repository;

import com.ssafy.yorr.game.domain.GameScoreSnapshot;
import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.exception.GameScoreQueryException;
import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.dto.RoomPhase;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Repository;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.GAME_NOT_STARTED;
import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.PLAYER_NOT_IN_ROOM;
import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.ROOM_NOT_FOUND;
import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.STORE_FAILURE;

@Repository
public class RedisGameScoreQueryStore implements GameScoreQueryStore {

    private static final int MAX_READ_ATTEMPTS = 2;

    private final RedisTemplate<String, String> redisTemplate;

    public RedisGameScoreQueryStore(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @Override
    public GameScoreSnapshot findByRoomId(String roomId, String requesterId) {
        validateIdentifier(roomId, "roomId", ROOM_NOT_FOUND);
        validateIdentifier(requesterId, "requesterId", PLAYER_NOT_IN_ROOM);

        for (int attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
            GameScoreSnapshot snapshot = readSnapshot(roomId, requesterId);
            if (isStillCurrent(snapshot)) {
                return snapshot;
            }
        }
        throw new GameScoreQueryException(
                STORE_FAILURE,
                "게임 점수판을 일관된 상태로 조회하지 못했습니다: " + roomId
        );
    }

    private GameScoreSnapshot readSnapshot(String roomId, String requesterId) {
        String roomKey = RoomRedisKeys.roomKey(roomId);
        Map<Object, Object> room = redisTemplate.<Object, Object>opsForHash().entries(roomKey);
        if (room.isEmpty()) {
            throw new GameScoreQueryException(ROOM_NOT_FOUND, "방을 찾을 수 없습니다: " + roomId);
        }

        String gameId = stringValue(room.get("gameId"));
        if (gameId == null || gameId.isBlank()) {
            throw new GameScoreQueryException(GAME_NOT_STARTED, "시작된 게임이 없습니다: " + roomId);
        }
        RoomPhase phase = parsePhase(room.get("phase"), roomId);
        validateGameMapping(roomId, gameId);

        Map<Object, Object> players = redisTemplate.<Object, Object>opsForHash()
                .entries(RoomRedisKeys.playersKey(roomId));
        if (!players.containsKey(requesterId)) {
            throw new GameScoreQueryException(
                    PLAYER_NOT_IN_ROOM,
                    "방 참가자가 아닙니다: " + requesterId
            );
        }

        LinkedHashMap<String, ScoreBoard> scoreboards = new LinkedHashMap<>();
        players.keySet().stream()
                .map(Object::toString)
                .sorted(Comparator.naturalOrder())
                .forEach(playerId -> scoreboards.put(playerId, readScoreBoard(gameId, playerId)));

        try {
            return new GameScoreSnapshot(roomId, gameId, phase, scoreboards);
        } catch (IllegalArgumentException exception) {
            throw new GameScoreQueryException(STORE_FAILURE, exception.getMessage(), exception);
        }
    }

    private void validateGameMapping(String roomId, String gameId) {
        Object mappedRoom = redisTemplate.<Object, Object>opsForHash()
                .get(RoomRedisKeys.gameKey(gameId), "roomCode");
        if (!roomId.equals(stringValue(mappedRoom))) {
            throw new GameScoreQueryException(
                    ROOM_NOT_FOUND,
                    "현재 방에 연결된 게임을 찾을 수 없습니다: " + roomId
            );
        }
    }

    private ScoreBoard readScoreBoard(String gameId, String playerId) {
        Map<Object, Object> stored = redisTemplate.<Object, Object>opsForHash()
                .entries(RoomRedisKeys.gameScoreboardKey(gameId, playerId));
        try {
            return RedisScoreBoardMapper.fromHash(stored);
        } catch (IllegalArgumentException exception) {
            throw new GameScoreQueryException(
                    STORE_FAILURE,
                    "Redis 점수판 값이 올바르지 않습니다: " + playerId,
                    exception
            );
        }
    }

    private boolean isStillCurrent(GameScoreSnapshot snapshot) {
        String roomKey = RoomRedisKeys.roomKey(snapshot.roomId());
        Object currentGameId = redisTemplate.<Object, Object>opsForHash().get(roomKey, "gameId");
        Object currentPhase = redisTemplate.<Object, Object>opsForHash().get(roomKey, "phase");
        Object currentRoom = redisTemplate.<Object, Object>opsForHash()
                .get(RoomRedisKeys.gameKey(snapshot.gameId()), "roomCode");
        Set<String> currentPlayers = new TreeSet<>(
                redisTemplate.<Object, Object>opsForHash()
                        .entries(RoomRedisKeys.playersKey(snapshot.roomId()))
                        .keySet()
                        .stream()
                        .map(Object::toString)
                        .toList()
        );
        return Objects.equals(snapshot.gameId(), stringValue(currentGameId))
                && Objects.equals(snapshot.phase().name(), stringValue(currentPhase))
                && Objects.equals(snapshot.roomId(), stringValue(currentRoom))
                && currentPlayers.equals(new TreeSet<>(snapshot.scoreboards().keySet()));
    }

    private static RoomPhase parsePhase(Object value, String roomId) {
        try {
            return RoomPhase.valueOf(stringValue(value));
        } catch (IllegalArgumentException | NullPointerException exception) {
            throw new GameScoreQueryException(
                    STORE_FAILURE,
                    "방 상태가 올바르지 않습니다: " + roomId,
                    exception
            );
        }
    }

    private static String stringValue(Object value) {
        return value == null ? null : value.toString();
    }

    private static void validateIdentifier(
            String value,
            String fieldName,
            GameScoreQueryException.Reason reason
    ) {
        if (value == null || value.isBlank()) {
            throw new GameScoreQueryException(reason, fieldName + " must not be blank");
        }
    }
}
