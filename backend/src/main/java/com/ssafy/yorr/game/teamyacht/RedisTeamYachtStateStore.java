package com.ssafy.yorr.game.teamyacht;

import com.ssafy.yorr.room.RoomRedisKeys;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

/**
 * 조별과제 야트 상태 저장소. {@code RedisDuelStateStore}와 같은 모양이다 — 방 락으로
 * 읽기·규칙 적용·쓰기를 묶어, 세 명이 동시에 굴림/투표를 보내도 한 번에 하나만 반영된다.
 * <p>
 * 게임 모듈마다 파일을 복제하는 것이 이 저장소들의 규약이다. 공통화하면 모드 하나의 상태
 * 모양이 바뀔 때 나머지가 같이 흔들린다.
 */
@Repository
public class RedisTeamYachtStateStore {

    private static final Duration LOCK_TTL = Duration.ofSeconds(5);
    private static final long LOCK_WAIT_MILLIS = 2_000;
    private static final DefaultRedisScript<Long> UNLOCK = new DefaultRedisScript<>("""
            if redis.call('GET', KEYS[1]) == ARGV[1] then
                return redis.call('DEL', KEYS[1])
            end
            return 0
            """, Long.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public RedisTeamYachtStateStore(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    public void initialize(String roomId, TeamYachtState state) {
        Boolean created = redis.opsForValue().setIfAbsent(key(roomId), serialize(state));
        if (!Boolean.TRUE.equals(created)) throw new IllegalStateException("team_yacht_already_initialized");
        copyRoomTtl(roomId);
    }

    public Optional<TeamYachtState> find(String roomId) {
        String value = redis.opsForValue().get(key(roomId));
        return value == null ? Optional.empty() : Optional.of(deserialize(value));
    }

    /** 규칙을 적용하고 바뀐 상태를 저장한다. 변화가 없으면(= version 그대로) 비어 있다. */
    public Optional<TeamYachtState> mutate(String roomId, Function<TeamYachtState, TeamYachtState> mutation) {
        return withLock(roomId, () -> {
            String value = redis.opsForValue().get(key(roomId));
            if (value == null) return Optional.empty();
            TeamYachtState current = deserialize(value);
            TeamYachtState next = mutation.apply(current);
            if (next == null || next.version() == current.version()) return Optional.empty();
            redis.opsForValue().set(key(roomId), serialize(next));
            copyRoomTtl(roomId);
            return Optional.of(next);
        });
    }

    public boolean remove(String roomId) {
        return Boolean.TRUE.equals(redis.delete(key(roomId)));
    }

    private <T> T withLock(String roomId, java.util.concurrent.Callable<T> action) {
        String lockKey = key(roomId) + ":lock";
        String token = UUID.randomUUID().toString();
        long deadline = System.currentTimeMillis() + LOCK_WAIT_MILLIS;
        try {
            while (!Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(lockKey, token, LOCK_TTL))) {
                if (System.currentTimeMillis() >= deadline) throw new IllegalStateException("game_state_busy");
                Thread.sleep(10);
            }
            return action.call();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("game_state_interrupted", exception);
        } catch (RuntimeException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalStateException("game_state_store_failed", exception);
        } finally {
            redis.execute(UNLOCK, List.of(lockKey), token);
        }
    }

    private String serialize(TeamYachtState state) {
        try {
            return objectMapper.writeValueAsString(state);
        } catch (Exception exception) {
            throw new IllegalStateException("invalid_team_yacht_state", exception);
        }
    }

    private TeamYachtState deserialize(String value) {
        try {
            return objectMapper.readValue(value, TeamYachtState.class);
        } catch (Exception exception) {
            throw new IllegalStateException("invalid_team_yacht_state", exception);
        }
    }

    private void copyRoomTtl(String roomId) {
        Long ttl = redis.getExpire(RoomRedisKeys.roomKey(roomId), TimeUnit.MILLISECONDS);
        if (ttl != null && ttl > 0) redis.expire(key(roomId), Duration.ofMillis(ttl));
    }

    private static String key(String roomId) {
        if (roomId == null || roomId.isBlank()) throw new IllegalArgumentException("roomId must not be blank");
        return RoomRedisKeys.gameStateKey(roomId, TeamYachtGameModule.CODE);
    }
}
