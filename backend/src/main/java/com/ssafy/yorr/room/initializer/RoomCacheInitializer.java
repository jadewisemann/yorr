package com.ssafy.yorr.room.initializer;

import com.ssafy.yorr.room.RoomRedisKeys;
import lombok.AllArgsConstructor;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Set;

@Component
@AllArgsConstructor
public class RoomCacheInitializer {

    private final RedisTemplate<String, String> redisTemplate;

    @EventListener(ApplicationReadyEvent.class)
    public void clearRoomsOnStartup() {
        Set<String> keys = redisTemplate.keys(RoomRedisKeys.PREFIX + "*");
        if (keys != null && !keys.isEmpty()) {
            redisTemplate.delete(keys);
        }
    }
}
