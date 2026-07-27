package com.ssafy.yorr.game.repository;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.room.RoomRedisKeys;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.CATEGORY_ALREADY_USED;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.GAME_NOT_FOUND;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.PLAYER_NOT_IN_GAME;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.ROUND_ALREADY_SCORED;
import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.STORE_FAILURE;

@Repository
public class RedisScoreBoardStore implements ScoreBoardStore {

    private static final String UPPER_SUBTOTAL_FIELD = "_upperSubtotal";
    private static final String UPPER_BONUS_FIELD = "_upperBonus";
    private static final String TOTAL_FIELD = "_total";

    private static final long SUCCESS = 0L;
    private static final long GAME_MISSING = 1L;
    private static final long GAME_ROOM_CHANGED = 2L;
    private static final long PLAYER_MISSING = 3L;
    private static final long ROUND_CONFLICT = 4L;
    private static final long IDEMPOTENT_RETRY = 5L;
    private static final long CATEGORY_CONFLICT = 6L;
    private static final long ROOM_MISSING = 7L;
    private static final long ROOM_GAME_CHANGED = 8L;
    private static final long GAME_NOT_PLAYING = 9L;

    private static final DefaultRedisScript<Long> CONFIRM_SCORE = new DefaultRedisScript<>("""
            local mappedRoom = redis.call('HGET', KEYS[1], 'roomCode')
            if not mappedRoom then return 1 end
            if mappedRoom ~= ARGV[1] then return 2 end
            if redis.call('EXISTS', KEYS[2]) == 0 then return 7 end
            if redis.call('HGET', KEYS[2], 'gameId') ~= ARGV[2] then return 8 end
            if redis.call('HGET', KEYS[2], 'phase') ~= 'PLAYING' then return 9 end
            if redis.call('HEXISTS', KEYS[3], ARGV[3]) == 0 then return 3 end

            local previous = redis.call('HGET', KEYS[5], ARGV[4])
            if previous then
                if previous == ARGV[8] then return 5 end
                return 4
            end
            if redis.call('HEXISTS', KEYS[4], ARGV[5]) == 1 then return 6 end

            local score = tonumber(ARGV[6])
            local upperSubtotal = tonumber(redis.call('HGET', KEYS[4], '_upperSubtotal') or '0')
            local upperBonus = tonumber(redis.call('HGET', KEYS[4], '_upperBonus') or '0')
            local total = tonumber(redis.call('HGET', KEYS[4], '_total') or '0')

            if ARGV[7] == '1' then
                upperSubtotal = upperSubtotal + score
            end
            local nextBonus = 0
            if upperSubtotal >= 63 then nextBonus = 35 end
            total = total + score + nextBonus - upperBonus

            redis.call('HSET', KEYS[4],
                ARGV[5], ARGV[6],
                '_upperSubtotal', tostring(upperSubtotal),
                '_upperBonus', tostring(nextBonus),
                '_total', tostring(total))
            redis.call('HSET', KEYS[5], ARGV[4], ARGV[8])
            redis.call('HSET', KEYS[6], ARGV[3], tostring(total))

            local ttl = redis.call('PTTL', KEYS[1])
            if ttl > 0 then
                redis.call('PEXPIRE', KEYS[4], ttl)
                redis.call('PEXPIRE', KEYS[5], ttl)
            end
            return 0
            """, Long.class);

    private final RedisTemplate<String, String> redisTemplate;

    public RedisScoreBoardStore(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @Override
    public ScoreBoard confirmScore(
            String gameId,
            String playerId,
            int roundNumber,
            ScoreCategory category,
            int score,
            String requestSignature
    ) {
        String gameKey = RoomRedisKeys.gameKey(gameId);
        Object roomCodeValue = redisTemplate.<Object, Object>opsForHash().get(gameKey, "roomCode");
        if (!(roomCodeValue instanceof String roomCode) || roomCode.isBlank()) {
            throw new ScoreConfirmationException(GAME_NOT_FOUND, "게임을 찾을 수 없습니다: " + gameId);
        }

        List<String> keys = List.of(
                gameKey,
                RoomRedisKeys.roomKey(roomCode),
                RoomRedisKeys.playersKey(roomCode),
                RoomRedisKeys.gameScoreboardKey(gameId, playerId),
                RoomRedisKeys.gameScoreSubmissionsKey(gameId, playerId),
                RoomRedisKeys.scoresKey(roomCode)
        );
        Long result = redisTemplate.execute(
                CONFIRM_SCORE,
                keys,
                roomCode,
                gameId,
                playerId,
                String.valueOf(roundNumber),
                category.apiKey(),
                String.valueOf(score),
                category.isUpperCategory() ? "1" : "0",
                requestSignature
        );

        if (result == null) {
            throw new ScoreConfirmationException(STORE_FAILURE, "Redis 점수 확정 결과를 받지 못했습니다.");
        }
        if (result == GAME_MISSING
                || result == GAME_ROOM_CHANGED
                || result == ROOM_MISSING
                || result == ROOM_GAME_CHANGED) {
            throw new ScoreConfirmationException(GAME_NOT_FOUND, "게임 상태가 존재하지 않습니다: " + gameId);
        }
        if (result == GAME_NOT_PLAYING) {
            throw new ScoreConfirmationException(
                    ScoreConfirmationException.Reason.GAME_NOT_ACTIVE,
                    "진행 중인 게임이 아닙니다: " + gameId
            );
        }
        if (result == PLAYER_MISSING) {
            throw new ScoreConfirmationException(PLAYER_NOT_IN_GAME, "게임 참가자가 아닙니다: " + playerId);
        }
        if (result == ROUND_CONFLICT) {
            throw new ScoreConfirmationException(
                    ROUND_ALREADY_SCORED,
                    "해당 라운드의 점수가 이미 확정되었습니다: " + roundNumber
            );
        }
        if (result == CATEGORY_CONFLICT) {
            throw new ScoreConfirmationException(
                    CATEGORY_ALREADY_USED,
                    "이미 사용한 점수 카테고리입니다: " + category.apiKey()
            );
        }
        if (result != SUCCESS && result != IDEMPOTENT_RETRY) {
            throw new ScoreConfirmationException(STORE_FAILURE, "알 수 없는 Redis 점수 확정 결과입니다: " + result);
        }

        return readScoreBoard(gameId, playerId);
    }

    private ScoreBoard readScoreBoard(String gameId, String playerId) {
        Map<Object, Object> stored = redisTemplate.<Object, Object>opsForHash()
                .entries(RoomRedisKeys.gameScoreboardKey(gameId, playerId));
        LinkedHashMap<String, Integer> categories = new LinkedHashMap<>();
        for (ScoreCategory category : ScoreCategory.values()) {
            categories.put(category.apiKey(), integerValue(stored.get(category.apiKey()), null));
        }
        return new ScoreBoard(
                categories,
                integerValue(stored.get(UPPER_SUBTOTAL_FIELD), 0),
                integerValue(stored.get(UPPER_BONUS_FIELD), 0),
                integerValue(stored.get(TOTAL_FIELD), 0)
        );
    }

    private static Integer integerValue(Object value, Integer defaultValue) {
        if (value == null) {
            return defaultValue;
        }
        try {
            return Integer.valueOf(value.toString());
        } catch (NumberFormatException exception) {
            throw new ScoreConfirmationException(
                    STORE_FAILURE,
                    "Redis 점수 값이 올바른 정수가 아닙니다: " + value,
                    exception
            );
        }
    }
}
