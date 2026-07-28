package com.ssafy.yorr.room.service;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.script.DefaultRedisScript;

import static org.assertj.core.api.Assertions.assertThat;

class RoomValidationServiceTest {

    @Test
    void startsWithAtLeastOnePlayer() {
        assertThat(RoomValidationService.START.getScriptAsString())
                .contains("redis.call('HLEN', KEYS[2]) < 1");
    }
}
