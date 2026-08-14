package com.ssafy.yorr.room.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class BotParticipantServiceTest {

    @Test
    void addChecksHostLobbyAndCapacityBeforeWritingEveryParticipantKey() {
        String script = BotParticipantService.ADD.getScriptAsString();

        assertThat(script)
                .contains("'phase') ~= 'LOBBY'")
                .contains("'hostId') ~= ARGV[1]")
                .contains("redis.call('HLEN', KEYS[2]) >=")
                .contains("redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])")
                .contains("redis.call('HSET', KEYS[3], ARGV[2], '0')")
                .contains("redis.call('HSET', KEYS[4], ARGV[2], ARGV[4])");
    }

    @Test
    void removeOnlyDeletesAStoredBot() {
        assertThat(BotParticipantService.REMOVE.getScriptAsString())
                .contains("redis.call('HDEL', KEYS[4], ARGV[2])")
                .contains("redis.call('HDEL', KEYS[2], ARGV[2])")
                .contains("redis.call('HDEL', KEYS[3], ARGV[2])");
    }
}
