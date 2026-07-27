package com.ssafy.yorr.room.service;

import com.ssafy.yorr.room.RoomRedisKeys;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class RoomCreateService {

    private static final String CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Duration ROOM_TTL = Duration.ofMinutes(40);
    private static final DefaultRedisScript<Long> CREATE = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
            redis.call('HSET', KEYS[1], 'capacity', ARGV[1], 'members', '0', 'phase', 'LOBBY', 'hostId', ARGV[2])
            redis.call('EXPIRE', KEYS[1], ARGV[3])
            return 1
            """, Long.class);
    private final RedisTemplate<String, String> redisTemplate;

    public String createRoom(int capacity, String hostId) {
        if (capacity < 1) throw new IllegalArgumentException("invalid_capacity");
        String roomCode;
        do {
            roomCode = randomCode();
        } while (!created(roomCode, capacity, hostId));
        return roomCode;
    }

    public Set<String> getAllRoomNumbers() {
        Set<String> result = new HashSet<>();
        try (Cursor<byte[]> cursor = redisTemplate.getConnectionFactory().getConnection()
                .scan(ScanOptions.scanOptions().match(RoomRedisKeys.PREFIX + "*").build())) {
            cursor.forEachRemaining(key -> {
                String roomCode = new String(key).substring(RoomRedisKeys.PREFIX.length());
                if (!roomCode.contains(":")) result.add(roomCode);
            });
        }
        return result;
    }

    private boolean created(String roomCode, int capacity, String hostId) {
        Long result = redisTemplate.execute(CREATE, List.of(RoomRedisKeys.roomKey(roomCode)), String.valueOf(capacity), hostId,
                String.valueOf(ROOM_TTL.toSeconds()));
        return Long.valueOf(1).equals(result);
    }

    private static String randomCode() {
        StringBuilder code = new StringBuilder(6);
        for (int i = 0; i < 6; i++) code.append(CHARS.charAt(RANDOM.nextInt(CHARS.length())));
        return code.toString();
    }
}
