package com.ssafy.yorr.room.service;

import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.dto.BotDifficulty;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class BotParticipantService {

    static final DefaultRedisScript<Long> ADD = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
            if redis.call('HGET', KEYS[1], 'phase') ~= 'LOBBY' then return 2 end
            if redis.call('HGET', KEYS[1], 'hostId') ~= ARGV[1] then return 3 end
            if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 0 then return 3 end
            if redis.call('HLEN', KEYS[2]) >= tonumber(redis.call('HGET', KEYS[1], 'capacity')) then return 4 end
            if redis.call('HEXISTS', KEYS[2], ARGV[2]) == 1 then return 5 end
            redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
            redis.call('HSET', KEYS[3], ARGV[2], '0')
            redis.call('HSET', KEYS[4], ARGV[2], ARGV[4])
            redis.call('HINCRBY', KEYS[1], 'members', 1)
            local ttl = redis.call('PTTL', KEYS[1])
            if ttl > 0 then
                redis.call('PEXPIRE', KEYS[2], ttl)
                redis.call('PEXPIRE', KEYS[3], ttl)
                redis.call('PEXPIRE', KEYS[4], ttl)
            end
            return 1
            """, Long.class);

    static final DefaultRedisScript<Long> UPDATE = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
            if redis.call('HGET', KEYS[1], 'phase') ~= 'LOBBY' then return 2 end
            if redis.call('HGET', KEYS[1], 'hostId') ~= ARGV[1] then return 3 end
            if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 0 then return 3 end
            if redis.call('HEXISTS', KEYS[3], ARGV[2]) == 0 then return 4 end
            redis.call('HSET', KEYS[3], ARGV[2], ARGV[3])
            return 1
            """, Long.class);

    static final DefaultRedisScript<Long> REMOVE = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
            if redis.call('HGET', KEYS[1], 'phase') ~= 'LOBBY' then return 2 end
            if redis.call('HGET', KEYS[1], 'hostId') ~= ARGV[1] then return 3 end
            if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 0 then return 3 end
            if redis.call('HDEL', KEYS[4], ARGV[2]) == 0 then return 4 end
            redis.call('HDEL', KEYS[2], ARGV[2])
            redis.call('HDEL', KEYS[3], ARGV[2])
            redis.call('HINCRBY', KEYS[1], 'members', -1)
            return 1
            """, Long.class);

    private final RedisTemplate<String, String> redisTemplate;
    private final RoomValidationService rooms;

    public RoomSnapshot add(String roomCode, String requesterId, BotDifficulty difficulty) {
        requireDifficulty(difficulty);
        String botId = "bot-" + UUID.randomUUID();
        String nickname = "요르봇 " + botId.substring(botId.length() - 4).toUpperCase(Locale.ROOT);
        Long result = redisTemplate.execute(
                ADD,
                keys(roomCode),
                requesterId,
                botId,
                nickname,
                difficulty.name()
        );
        requireSuccess(result, false);
        return rooms.getSnapshot(roomCode);
    }

    public RoomSnapshot update(
            String roomCode,
            String requesterId,
            String botId,
            BotDifficulty difficulty
    ) {
        requireDifficulty(difficulty);
        Long result = redisTemplate.execute(
                UPDATE,
                List.of(
                        RoomRedisKeys.roomKey(roomCode),
                        RoomRedisKeys.playersKey(roomCode),
                        RoomRedisKeys.botsKey(roomCode)
                ),
                requesterId,
                botId,
                difficulty.name()
        );
        requireSuccess(result, true);
        return rooms.getSnapshot(roomCode);
    }

    public RoomSnapshot remove(String roomCode, String requesterId, String botId) {
        Long result = redisTemplate.execute(REMOVE, keys(roomCode), requesterId, botId);
        requireSuccess(result, true);
        return rooms.getSnapshot(roomCode);
    }

    private static List<String> keys(String roomCode) {
        return List.of(
                RoomRedisKeys.roomKey(roomCode),
                RoomRedisKeys.playersKey(roomCode),
                RoomRedisKeys.scoresKey(roomCode),
                RoomRedisKeys.botsKey(roomCode)
        );
    }

    private static void requireDifficulty(BotDifficulty difficulty) {
        if (difficulty == null) throw new IllegalArgumentException("invalid_difficulty");
    }

    private static void requireSuccess(Long result, boolean botMustExist) {
        if (Long.valueOf(1).equals(result)) return;
        if (Long.valueOf(0).equals(result)) throw new IllegalArgumentException("room_not_found");
        if (Long.valueOf(2).equals(result)) throw new IllegalStateException("lobby_only");
        if (Long.valueOf(3).equals(result)) throw new SecurityException("host_only");
        if (Long.valueOf(4).equals(result)) {
            throw new IllegalStateException(botMustExist ? "bot_not_found" : "room_full");
        }
        throw new IllegalStateException("bot_operation_failed");
    }
}
