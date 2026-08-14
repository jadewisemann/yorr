package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.round.application.port.RoundStateStore;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.game.round.domain.RoundSynchronizationException;
import com.ssafy.yorr.room.RoomRedisKeys;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

@Repository
public class RedisYachtDiceStateStore implements RoundStateStore {

    private static final String GAME_CODE = "YACHT_DICE";
    // ponytail: short room lock fits current Redis work; replace with one Lua state+score transition if work exceeds 5s.
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

    public RedisYachtDiceStateStore(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    @Override
    public void initialize(String roomId, RoundState initialState) {
        validate(roomId);
        if (initialState == null) throw new IllegalArgumentException("initialState must not be null");
        Boolean created = redis.opsForValue().setIfAbsent(stateKey(roomId), serialize(initialState));
        if (!Boolean.TRUE.equals(created)) {
            throw new RoundSynchronizationException(
                    RoundSynchronizationException.Reason.ROUND_ALREADY_INITIALIZED,
                    "round state already initialized for room: " + roomId
            );
        }
        copyRoomTtl(roomId);
    }

    @Override
    public RoundSubmissionResult submitAtomically(
            String roomId,
            RoundSubmission submission,
            Runnable beforeStateChange
    ) {
        if (submission == null) throw new IllegalArgumentException("submission must not be null");
        if (beforeStateChange == null) throw new IllegalArgumentException("beforeStateChange must not be null");
        return mutateRequired(roomId, current -> {
            RoundSubmissionResult result = current.submit(submission);
            beforeStateChange.run();
            return new Change<>(result.state(), result);
        });
    }

    @Override
    public RoundState recordRollAtomically(
            String roomId,
            String playerId,
            int roundNumber,
            int rollCount,
            List<Boolean> held,
            List<Integer> rolledDice
    ) {
        return mutateRequired(roomId, current -> {
            RoundState next = current.recordRoll(playerId, roundNumber, rollCount, held, rolledDice);
            return new Change<>(next, next);
        });
    }

    @Override
    public RoundState recordHoldAtomically(
            String roomId,
            String playerId,
            int roundNumber,
            List<Boolean> held
    ) {
        return mutateRequired(roomId, current -> {
            RoundState next = current.recordHold(playerId, roundNumber, held);
            return new Change<>(next, next);
        });
    }

    @Override
    public Optional<RoundState> autoRollAtomically(
            String roomId,
            int expectedRoundNumber,
            String expectedActivePlayerId,
            List<Integer> rolledDice
    ) {
        return mutateOptional(roomId, current -> {
            if (stale(current, expectedRoundNumber, expectedActivePlayerId) || !current.hasRollsLeft()) {
                return null;
            }
            RoundState next = current.autoRoll(rolledDice);
            return new Change<>(next, next);
        });
    }

    @Override
    public Optional<RoundSubmissionResult> expireAtomically(
            String roomId,
            int expectedRoundNumber,
            String expectedActivePlayerId
    ) {
        return mutateOptional(roomId, current -> {
            if (stale(current, expectedRoundNumber, expectedActivePlayerId)) return null;
            RoundSubmissionResult result = current.expire();
            return new Change<>(result.state(), result);
        });
    }

    @Override
    public Optional<RoundState> removeParticipantAtomically(String roomId, String playerId) {
        return mutateOptional(roomId, current -> {
            RoundState next = current.withoutParticipant(playerId);
            return new Change<>(next, next);
        });
    }

    @Override
    public Optional<RoundState> findByRoomId(String roomId) {
        validate(roomId);
        String stored = redis.opsForValue().get(stateKey(roomId));
        return stored == null ? Optional.empty() : Optional.of(deserialize(stored));
    }

    @Override
    public Set<String> roomIds() {
        String prefix = RoomRedisKeys.PREFIX;
        String suffix = ":game:" + GAME_CODE + ":state";
        Set<String> roomIds = new LinkedHashSet<>();
        try (Cursor<String> keys = redis.scan(ScanOptions.scanOptions()
                .match(prefix + "*" + suffix)
                .count(100)
                .build())) {
            keys.forEachRemaining(key ->
                    roomIds.add(key.substring(prefix.length(), key.length() - suffix.length())));
        }
        return Set.copyOf(roomIds);
    }

    @Override
    public boolean remove(String roomId) {
        validate(roomId);
        return Boolean.TRUE.equals(redis.delete(stateKey(roomId)));
    }

    private <T> T mutateRequired(String roomId, Function<RoundState, Change<T>> mutation) {
        return mutateOptional(roomId, mutation).orElseThrow(() -> new RoundSynchronizationException(
                RoundSynchronizationException.Reason.ROUND_NOT_INITIALIZED,
                "round state is not initialized for room: " + roomId
        ));
    }

    private <T> Optional<T> mutateOptional(String roomId, Function<RoundState, Change<T>> mutation) {
        validate(roomId);
        return withLock(roomId, () -> {
            String stored = redis.opsForValue().get(stateKey(roomId));
            if (stored == null) return Optional.empty();
            Change<T> change = mutation.apply(deserialize(stored));
            if (change == null) return Optional.empty();
            redis.opsForValue().set(stateKey(roomId), serialize(change.state()));
            copyRoomTtl(roomId);
            return Optional.of(change.result());
        });
    }

    private <T> T withLock(String roomId, java.util.concurrent.Callable<T> action) {
        String lockKey = stateKey(roomId) + ":lock";
        String token = UUID.randomUUID().toString();
        long deadline = System.currentTimeMillis() + LOCK_WAIT_MILLIS;
        try {
            while (!Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(lockKey, token, LOCK_TTL))) {
                if (System.currentTimeMillis() >= deadline) {
                    throw new IllegalStateException("game_state_busy");
                }
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

    private String serialize(RoundState state) {
        try {
            return objectMapper.writeValueAsString(YachtDiceStateSnapshot.from(state));
        } catch (Exception exception) {
            throw new IllegalStateException("invalid_yacht_state", exception);
        }
    }

    private RoundState deserialize(String value) {
        try {
            return objectMapper.readValue(value, YachtDiceStateSnapshot.class).toDomain();
        } catch (Exception exception) {
            throw new IllegalStateException("invalid_yacht_state", exception);
        }
    }

    private void copyRoomTtl(String roomId) {
        Long ttl = redis.getExpire(RoomRedisKeys.roomKey(roomId), TimeUnit.MILLISECONDS);
        if (ttl != null && ttl > 0) redis.expire(stateKey(roomId), Duration.ofMillis(ttl));
    }

    private static boolean stale(RoundState state, int roundNumber, String playerId) {
        return state.isFinished()
                || state.roundNumber() != roundNumber
                || !state.activePlayerId().equals(playerId);
    }

    private static void validate(String roomId) {
        if (roomId == null || roomId.isBlank()) throw new IllegalArgumentException("roomId must not be blank");
    }

    private static String stateKey(String roomId) {
        return RoomRedisKeys.gameStateKey(roomId, GAME_CODE);
    }

    private record Change<T>(RoundState state, T result) {}
}
