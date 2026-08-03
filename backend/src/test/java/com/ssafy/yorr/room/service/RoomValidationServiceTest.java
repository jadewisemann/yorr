package com.ssafy.yorr.room.service;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.script.DefaultRedisScript;

import static org.assertj.core.api.Assertions.assertThat;

class RoomValidationServiceTest {

    @Test
    void startsWithTheGameModulesMinimumPlayerCount() {
        assertThat(RoomValidationService.START.getScriptAsString())
                .contains("redis.call('HLEN', KEYS[2]) < tonumber(ARGV[3])")
                .contains("'gameCode', gameCode");
    }

    @Test
    void rollbackOnlyTouchesTheGameThatFailedToInitialize() {
        assertThat(RoomValidationService.ROLLBACK_START.getScriptAsString())
                .contains("redis.call('HGET', KEYS[1], 'gameId') ~= ARGV[1]");
    }
}
