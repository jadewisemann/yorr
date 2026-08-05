package com.ssafy.yorr.game.liars;

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
 * 라이어스 판 상태의 저장소. 탁구·결투의 상태 저장소와 같은 형태다 —
 * 방 하나당 키 하나, 갱신은 방 락 안에서만(선언과 챌린지가 같은 순간에 도착해도 판이 갈라지지 않는다).
 *
 * <p>이 키에는 손패(비밀)가 그대로 들어간다. 나가는 길은 {@link LiarsState#view()} 하나뿐이므로
 * 저장소는 상태를 통째로 다루고, 무엇을 보낼지는 서비스가 정한다.
 */
@Repository
public class RedisLiarsStateStore {

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

    public RedisLiarsStateStore(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    public void initialize(String roomId, LiarsState state) {
        Boolean created = redis.opsForValue().setIfAbsent(key(roomId), serialize(state));
        if (!Boolean.TRUE.equals(created)) throw new IllegalStateException("liars_already_initialized");
        copyRoomTtl(roomId);
    }

    public Optional<LiarsState> find(String roomId) {
        String value = redis.opsForValue().get(key(roomId));
        return value == null ? Optional.empty() : Optional.of(deserialize(value));
    }

    public Optional<LiarsState> mutate(String roomId, Function<LiarsState, LiarsState> mutation) {
        return withLock(roomId, () -> {
            String value = redis.opsForValue().get(key(roomId));
            if (value == null) return Optional.empty();
            LiarsState current = deserialize(value);
            LiarsState next = mutation.apply(current);
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

    private String serialize(LiarsState state) {
        try {
            return objectMapper.writeValueAsString(state);
        } catch (Exception exception) {
            throw new IllegalStateException("invalid_liars_state", exception);
        }
    }

    private LiarsState deserialize(String value) {
        try {
            return objectMapper.readValue(value, LiarsState.class);
        } catch (Exception exception) {
            throw new IllegalStateException("invalid_liars_state", exception);
        }
    }

    private void copyRoomTtl(String roomId) {
        Long ttl = redis.getExpire(RoomRedisKeys.roomKey(roomId), TimeUnit.MILLISECONDS);
        if (ttl != null && ttl > 0) redis.expire(key(roomId), Duration.ofMillis(ttl));
    }

    private static String key(String roomId) {
        if (roomId == null || roomId.isBlank()) throw new IllegalArgumentException("roomId must not be blank");
        return RoomRedisKeys.gameStateKey(roomId, LiarsGameModule.CODE);
    }
}
