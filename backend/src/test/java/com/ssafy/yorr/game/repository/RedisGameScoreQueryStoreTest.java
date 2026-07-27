package com.ssafy.yorr.game.repository;

import com.ssafy.yorr.game.domain.GameScoreSnapshot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.RedisTemplate;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RedisGameScoreQueryStoreTest {

    private HashOperations<String, Object, Object> hashOperations;
    private RedisGameScoreQueryStore store;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        RedisTemplate<String, String> redisTemplate = mock(RedisTemplate.class);
        hashOperations = mock(HashOperations.class);
        when(redisTemplate.<Object, Object>opsForHash()).thenReturn(hashOperations);
        store = new RedisGameScoreQueryStore(redisTemplate);
    }

    @Test
    void retriesWithCurrentGameWhenGameChangesDuringRead() {
        when(hashOperations.entries("room:ROOM1"))
                .thenReturn(
                        Map.of("gameId", "game-a", "phase", "PLAYING"),
                        Map.of("gameId", "game-b", "phase", "PLAYING")
                );
        when(hashOperations.entries("room:ROOM1:players"))
                .thenReturn(Map.of("player-a", "A"));
        when(hashOperations.entries("game:game-a:scoreboard:player-a"))
                .thenReturn(Map.of("_total", "10"));
        when(hashOperations.entries("game:game-b:scoreboard:player-a"))
                .thenReturn(Map.of("_total", "20"));
        when(hashOperations.get("game:game-a", "roomCode")).thenReturn("ROOM1");
        when(hashOperations.get("game:game-b", "roomCode")).thenReturn("ROOM1");
        when(hashOperations.get("room:ROOM1", "gameId"))
                .thenReturn("game-b");
        when(hashOperations.get("room:ROOM1", "phase"))
                .thenReturn("PLAYING");

        GameScoreSnapshot snapshot = store.findByRoomId("ROOM1", "player-a");

        assertThat(snapshot.gameId()).isEqualTo("game-b");
        assertThat(snapshot.scoreboards().get("player-a").total()).isEqualTo(20);
    }
}
