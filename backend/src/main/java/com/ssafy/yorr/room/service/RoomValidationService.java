package com.ssafy.yorr.room.service;

import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.dto.RoomStatusDTO;
import lombok.AllArgsConstructor;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

@Service
@AllArgsConstructor
public class RoomValidationService {

    private static final DefaultRedisScript<Long> JOIN_ROOM = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
            if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return 4 end
            if redis.call('HGET', KEYS[1], 'started') == 'true' then return 2 end
            if tonumber(redis.call('HGET', KEYS[1], 'members')) >= tonumber(redis.call('HGET', KEYS[1], 'capacity')) then return 3 end
            redis.call('SADD', KEYS[2], ARGV[1])
            redis.call('HINCRBY', KEYS[1], 'members', 1)
            local ttl = redis.call('PTTL', KEYS[1])
            if ttl > 0 then redis.call('PEXPIRE', KEYS[2], ttl) end
            return 1
            """, Long.class);
    private static final DefaultRedisScript<Long> START_GAME = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
            if redis.call('HGET', KEYS[1], 'started') == 'true' then return 0 end
            if tonumber(redis.call('HGET', KEYS[1], 'members')) < tonumber(redis.call('HGET', KEYS[1], 'capacity')) then return 0 end
            redis.call('HSET', KEYS[1], 'started', 'true')
            return 1
            """, Long.class);
    private static final DefaultRedisScript<Long> LEAVE_ROOM = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
            if redis.call('SREM', KEYS[2], ARGV[1]) == 0 then return -1 end
            local members = redis.call('HINCRBY', KEYS[1], 'members', -1)
            if members <= 0 then
                redis.call('DEL', KEYS[1])
                redis.call('DEL', KEYS[2])
                return 0
            end
            return members
            """, Long.class);

    private final RedisTemplate<String, String> redisTemplate;

    public RoomStatusDTO getStatus(String id) {
        var room = redisTemplate.<Object, Object>opsForHash().entries(RoomRedisKeys.PREFIX + id);
        if (room.isEmpty()) return RoomStatusDTO.notFound();
        return new RoomStatusDTO(true, Integer.parseInt((String) room.get(RoomRedisKeys.CAPACITY)),
                Integer.parseInt((String) room.get(RoomRedisKeys.MEMBERS)),
                Boolean.parseBoolean((String) room.get(RoomRedisKeys.STARTED)));
    }

    public long joinRoom(String id, String playerId) {
        Long result = redisTemplate.execute(JOIN_ROOM,
                java.util.List.of(RoomRedisKeys.PREFIX + id, RoomRedisKeys.membersKey(id)), playerId);
        return result == null ? 0 : result;
    }

    public boolean startGame(String id) {
        Long result = redisTemplate.execute(START_GAME, java.util.List.of(RoomRedisKeys.PREFIX + id));
        return Long.valueOf(1).equals(result);
    }

    public long leaveRoom(String id, String playerId) {
        Long result = redisTemplate.execute(LEAVE_ROOM,
                java.util.List.of(RoomRedisKeys.PREFIX + id, RoomRedisKeys.membersKey(id)), playerId);
        return result == null ? -1 : result;
    }
}
