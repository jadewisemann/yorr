package com.ssafy.yorr.game.repository;

import com.ssafy.yorr.room.RoomRedisKeys;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Repository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class RedisGameCompletionStore implements GameCompletionStore {

    /** 요트 정규룰 족보 수. 이만큼 기록되면 그 플레이어의 점수판은 꽉 찬 것이다. */
    private static final int REQUIRED_CATEGORIES = 12;
    private static final long FINISHED_BY_THIS_CALL = 1L;

    /**
     * 완료 검사 + phase 전이를 한 번에 수행한다. 판정과 전이 사이에 다른 요청이 끼어들 수 없어야
     * {@code game.over}가 정확히 한 번 나간다.
     * <p>
     * 점수판 키는 스크립트 안에서 조립한다(참가자 수가 가변이라 KEYS로 미리 넘길 수 없다).
     * 단일 Redis 전제이며, 클러스터로 가면 참가자별 조회를 애플리케이션으로 올려야 한다.
     * 메타 필드는 {@code _} 접두사 규약을 쓰므로(_total 등) 그것만 세지 않으면 기록 칸 수가 된다.
     */
    private static final DefaultRedisScript<Long> FINISH_IF_COMPLETE = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
            if redis.call('HGET', KEYS[1], 'phase') ~= 'PLAYING' then return 0 end
            if redis.call('HGET', KEYS[1], 'gameId') ~= ARGV[1] then return 0 end

            if ARGV[2] ~= '1' then
                local players = redis.call('HKEYS', KEYS[2])
                if #players == 0 then return 0 end
                for i = 1, #players do
                    local fields = redis.call('HKEYS', 'game:' .. ARGV[1] .. ':scoreboard:' .. players[i])
                    local recorded = 0
                    for j = 1, #fields do
                        if string.sub(fields[j], 1, 1) ~= '_' then recorded = recorded + 1 end
                    end
                    if recorded < tonumber(ARGV[3]) then return 0 end
                end
            end

            redis.call('HSET', KEYS[1], 'phase', 'FINISHED')
            return 1
            """, Long.class);

    private final RedisTemplate<String, String> redisTemplate;

    public RedisGameCompletionStore(RedisTemplate<String, String> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @Override
    public boolean finishIfComplete(String roomCode, String gameId, boolean force) {
        if (roomCode == null || roomCode.isBlank() || gameId == null || gameId.isBlank()) {
            return false;
        }
        Long result = redisTemplate.execute(
                FINISH_IF_COMPLETE,
                List.of(RoomRedisKeys.roomKey(roomCode), RoomRedisKeys.playersKey(roomCode)),
                gameId,
                force ? "1" : "0",
                String.valueOf(REQUIRED_CATEGORIES)
        );
        return result != null && result == FINISHED_BY_THIS_CALL;
    }

    @Override
    public Map<String, Integer> readTotals(String roomCode) {
        Map<Object, Object> stored = redisTemplate.<Object, Object>opsForHash()
                .entries(RoomRedisKeys.scoresKey(roomCode));
        Map<String, Integer> totals = new LinkedHashMap<>();
        stored.forEach((playerId, total) -> totals.put(String.valueOf(playerId), parseTotal(total)));
        return totals;
    }

    private static int parseTotal(Object value) {
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException exception) {
            return 0;
        }
    }
}
