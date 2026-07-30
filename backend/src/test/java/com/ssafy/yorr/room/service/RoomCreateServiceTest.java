package com.ssafy.yorr.room.service;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.RedisTemplate;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

class RoomCreateServiceTest {

    @Test
    void capacityMustBePositive() {
        assertThrows(IllegalArgumentException.class,
                () -> new RoomCreateService(mock(RedisTemplate.class)).createRoom(0, "host"));
    }
}
