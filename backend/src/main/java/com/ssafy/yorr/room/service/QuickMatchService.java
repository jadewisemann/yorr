package com.ssafy.yorr.room.service;

import com.ssafy.yorr.game.module.GameLifecycleService;
import com.ssafy.yorr.game.module.GameModule;
import com.ssafy.yorr.game.module.GameModuleRegistry;
import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.dto.QuickMatchResponse;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.service.UserService;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class QuickMatchService {

    private static final Duration WAIT_TTL = Duration.ofMinutes(5);
    private static final Duration LOCK_TTL = Duration.ofSeconds(5);
    // ponytail: per-game lock reuses room services; move matching + room creation into one Lua script if crash recovery matters.
    private static final DefaultRedisScript<Long> UNLOCK = new DefaultRedisScript<>("""
            if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
            return 0
            """, Long.class);

    private final RedisTemplate<String, String> redis;
    private final RoomCreateService roomCreates;
    private final RoomValidationService rooms;
    private final UserService users;
    private final RoomSessionRegistry sessions;
    private final GameLifecycleService games;
    private final GameModuleRegistry gameModules;

    public QuickMatchService(
            RedisTemplate<String, String> redis,
            RoomCreateService roomCreates,
            RoomValidationService rooms,
            UserService users,
            RoomSessionRegistry sessions,
            GameLifecycleService games,
            GameModuleRegistry gameModules
    ) {
        this.redis = redis;
        this.roomCreates = roomCreates;
        this.rooms = rooms;
        this.users = users;
        this.sessions = sessions;
        this.games = games;
        this.gameModules = gameModules;
    }

    public QuickMatchResponse enter(UserIdentity user, String gameCode) {
        QuickMatchResponse current = statusOf(user.userId());
        if (current.status() != QuickMatchResponse.Status.NOT_QUEUED) return current;
        if (redis.opsForHash().hasKey("user:" + user.userId(), "roomId")) {
            throw new IllegalStateException("already_in_room");
        }
        int playerCount = playerCount(gameCode);

        String ticket = ticketKey(user.userId());
        redis.opsForHash().putAll(ticket, Map.of("status", "WAITING", "gameCode", gameCode));
        redis.expire(ticket, WAIT_TTL);
        redis.opsForZSet().add(queueKey(gameCode), user.userId(), System.currentTimeMillis());
        match(gameCode, playerCount);
        return status(user.userId());
    }

    public QuickMatchResponse status(String userId) {
        QuickMatchResponse response = statusOf(userId);
        if (response.roomId() != null) startIfReady(response.roomId());
        return statusOf(userId);
    }

    public QuickMatchResponse cancel(String userId) {
        QuickMatchResponse current = statusOf(userId);
        if (current.status() != QuickMatchResponse.Status.WAITING) return current;
        redis.opsForZSet().remove(queueKey(current.gameCode()), userId);
        redis.delete(ticketKey(userId));
        return new QuickMatchResponse(QuickMatchResponse.Status.NOT_QUEUED, null, current.gameCode());
    }

    private void match(String gameCode, int playerCount) {
        String lockKey = "quick-match:lock:" + gameCode;
        String token = UUID.randomUUID().toString();
        if (!Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(lockKey, token, LOCK_TTL))) return;
        try {
            redis.opsForZSet().removeRangeByScore(queueKey(gameCode), 0,
                    System.currentTimeMillis() - WAIT_TTL.toMillis());
            Set<String> candidates = redis.opsForZSet().range(queueKey(gameCode), 0, playerCount - 1);
            if (candidates == null || candidates.size() < playerCount) return;
            List<String> playerIds = List.copyOf(candidates);
            List<UserIdentity> players = playerIds.stream().map(this::identity).toList();
            if (players.stream().anyMatch(java.util.Objects::isNull)) {
                for (int i = 0; i < players.size(); i++) {
                    if (players.get(i) == null) removeWaiting(gameCode, playerIds.get(i));
                }
                return;
            }

            UserIdentity host = players.get(0);
            String roomId = roomCreates.createRoom(playerCount, host.userId(), gameCode);
            try {
                for (UserIdentity player : players) {
                    rooms.join(roomId, player, null);
                    users.assignRoom(player.userId(), roomId, roomId, host.userId());
                }
            } catch (RuntimeException exception) {
                rooms.close(roomId);
                throw exception;
            }
            redis.opsForZSet().remove(queueKey(gameCode), playerIds.toArray());
            players.forEach(player -> markMatched(player.userId(), roomId, gameCode));
            redis.opsForValue().set(roomMarker(roomId), "1", RoomCreateService.ROOM_TTL);
        } finally {
            redis.execute(UNLOCK, List.of(lockKey), token);
        }
    }

    private void startIfReady(String roomId) {
        if (!Boolean.TRUE.equals(redis.hasKey(roomMarker(roomId)))) return;
        RoomSnapshot room = rooms.getSnapshot(roomId);
        if (room.phase() == RoomPhase.PLAYING) {
            redis.delete(roomMarker(roomId));
            return;
        }
        if (room.phase() != RoomPhase.LOBBY || room.players().size() != room.capacity()
                || room.players().stream().anyMatch(player -> {
                    RoomSessionRegistry.Member member = sessions.find(roomId, player.playerId());
                    return member == null || member.session() == null || !member.session().isOpen();
                })) return;
        try {
            games.start(roomId);
            redis.delete(roomMarker(roomId));
        } catch (IllegalStateException duplicateStart) {
            if (rooms.getSnapshot(roomId).phase() != RoomPhase.PLAYING) throw duplicateStart;
        }
    }

    private UserIdentity identity(String userId) {
        Map<Object, Object> stored = redis.<Object, Object>opsForHash().entries("user:" + userId);
        if (!(stored.get("nickname") instanceof String nickname)
                || !(stored.get("type") instanceof String type)) return null;
        try {
            return new UserIdentity(userId, nickname, UserType.valueOf(type));
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private QuickMatchResponse statusOf(String userId) {
        Map<Object, Object> ticket = redis.<Object, Object>opsForHash().entries(ticketKey(userId));
        if (ticket.isEmpty()) return new QuickMatchResponse(QuickMatchResponse.Status.NOT_QUEUED, null, null);
        String gameCode = (String) ticket.get("gameCode");
        String roomId = (String) ticket.get("roomId");
        if (roomId != null && rooms.getSnapshot(roomId).phase() == null) {
            redis.delete(ticketKey(userId));
            return new QuickMatchResponse(QuickMatchResponse.Status.NOT_QUEUED, null, gameCode);
        }
        QuickMatchResponse.Status status = roomId == null
                ? QuickMatchResponse.Status.WAITING
                : rooms.getSnapshot(roomId).phase() == RoomPhase.PLAYING
                ? QuickMatchResponse.Status.PLAYING
                : QuickMatchResponse.Status.MATCHED;
        return new QuickMatchResponse(status, roomId, gameCode);
    }

    private void markMatched(String userId, String roomId, String gameCode) {
        redis.opsForHash().putAll(ticketKey(userId),
                Map.of("status", "MATCHED", "roomId", roomId, "gameCode", gameCode));
        redis.expire(ticketKey(userId), RoomCreateService.ROOM_TTL);
    }

    private void removeWaiting(String gameCode, String userId) {
        redis.opsForZSet().remove(queueKey(gameCode), userId);
        redis.delete(ticketKey(userId));
    }

    private int playerCount(String gameCode) {
        GameModule game = gameModules.require(gameCode);
        int playerCount = Math.max(2, game.minPlayers());
        if (playerCount > game.maxPlayers()) throw new IllegalArgumentException("quick_match_not_supported");
        return playerCount;
    }

    private static String queueKey(String gameCode) {
        return "quick-match:queue:" + gameCode;
    }

    private static String ticketKey(String userId) {
        return "quick-match:user:" + userId;
    }

    private static String roomMarker(String roomId) {
        return RoomRedisKeys.roomKey(roomId) + ":quick-match";
    }
}
