package com.ssafy.yorr.room.service;

import com.ssafy.yorr.room.RoomRedisKeys;
import lombok.AllArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.HashSet;
import java.util.Set;

@Service
@AllArgsConstructor
public class RoomCreateService {

    private static final String CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int passwordLength = 6;
    private static final Duration ROOM_TTL = Duration.ofMinutes(40);
    private static final DefaultRedisScript<Long> CREATE_ROOM = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
            redis.call('HSET', KEYS[1], 'capacity', ARGV[1], 'members', '0', 'started', 'false')
            redis.call('EXPIRE', KEYS[1], ARGV[2])
            return 1
            """, Long.class);

    private final RedisTemplate<String, String> redisTemplate;

    public String createRoom(int capacity) {
        if (capacity < 1) throw new IllegalArgumentException("방 인원은 1명 이상이어야 합니다.");
        StringBuilder sb = new StringBuilder(passwordLength);
        for (int i = 0; i < passwordLength; i++) {
            sb.append(CHARS.charAt(RANDOM.nextInt(CHARS.length())));
        }
        String randomPassword = sb.toString();
        if (!addRoomNumber(randomPassword, capacity)) return createRoom(capacity);
        return randomPassword;
    }

    private boolean addRoomNumber(String roomNumber, int capacity) {
        String key = RoomRedisKeys.PREFIX + roomNumber;
        Long created = redisTemplate.execute(CREATE_ROOM, java.util.List.of(key),
                String.valueOf(capacity), String.valueOf(ROOM_TTL.toSeconds()));
        return Long.valueOf(1).equals(created);
    }

    public Set<String> getAllRoomNumbers() {
        Set<String> result = new HashSet<>();
        ScanOptions options = ScanOptions.scanOptions().match(RoomRedisKeys.PREFIX + "*").build();
        try (Cursor<byte[]> cursor = redisTemplate.getConnectionFactory()
                .getConnection().scan(options)) {
            cursor.forEachRemaining(k -> result.add(new String(k).substring(RoomRedisKeys.PREFIX.length())));
        }
        return result;
    }
}
