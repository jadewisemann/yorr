package com.ssafy.yorr.room.service;

import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.room.dto.JoinResult;
import com.ssafy.yorr.room.dto.ParticipantKind;
import com.ssafy.yorr.room.dto.RoomMode;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomPlayerSnapshot;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.user.UserIdentity;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class RoomValidationService implements RoomService {

    /**
     * 방에 들어간다. 들어오면서 <b>주인 없는 방의 방장을 이어받는다</b>.
     * <p>
     * 방장 조건을 "hostId가 명단에도 있을 것"으로 두고 있어(호스트 검사와 같은 규약), hostId가
     * 명단에 없는 방은 아무도 게임을 시작할 수 없는 방이다. 그런 방은 두 갈래로 생긴다 —
     * 파티 방을 연 대시보드는 애초에 명단에 들어가지 않고({@link com.ssafy.yorr.room.dto.RoomMode}),
     * 방장이 나간 뒤 {@link #LEAVE}가 이어받을 사람을 찾지 못하면 hostId가 비워진다.
     * 둘 다 "다음에 들어온 사람이 방장"으로 풀린다.
     * <p>
     * 일반 방을 만든 사람은 곧바로 이 경로로 들어와 hostId와 같은 값을 다시 쓰므로 종전과 같다.
     */
    private static final DefaultRedisScript<Long> JOIN = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
            if redis.call('HGET', KEYS[1], 'phase') ~= 'LOBBY' then return 2 end
            if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then return 4 end
            if redis.call('HLEN', KEYS[2]) >= tonumber(redis.call('HGET', KEYS[1], 'capacity')) then return 3 end
            redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
            redis.call('HSET', KEYS[3], ARGV[1], '0')
            redis.call('HINCRBY', KEYS[1], 'members', 1)
            local host = redis.call('HGET', KEYS[1], 'hostId')
            if not host or host == '' or redis.call('HEXISTS', KEYS[2], host) == 0 then
                redis.call('HSET', KEYS[1], 'hostId', ARGV[1])
            end
            local ttl = redis.call('PTTL', KEYS[1])
            if ttl > 0 then
                redis.call('PEXPIRE', KEYS[2], ttl)
                redis.call('PEXPIRE', KEYS[3], ttl)
                if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('PEXPIRE', KEYS[4], ttl) end
            end
            return 1
            """, Long.class);
    /**
     * 방을 떠난다. 마지막 참가자가 빠지면 방을 지우고, <b>방장이 빠지면 남은 사람에게 넘긴다</b>.
     * <p>
     * 방 삭제는 <b>파티 방만 예외</b>다. 파티 방을 연 대시보드는 플레이어 명단에 없어서 members에
     * 세어지지 않는다. 일반 방과 같이 처리하면 컨트롤러 하나가 잘못 들어왔다 나가는 것만으로
     * members가 0이 되어, 아직 QR을 띄우고 사람을 기다리는 대시보드의 방이 발밑에서 사라진다.
     * 파티 방은 대시보드가 소켓을 닫을 때 닫힌다(빈 방 검사는 WS 명단 기준이라 대시보드를 센다).
     * 그마저 놓치면 방 TTL이 상한이다.
     * <p>
     * 방장 승계는 두 모드에 <b>공통</b>이다. hostId는 한 번 적히면 그대로여서, 승계가 없으면 방장이
     * 나간 방은 아무도 게임을 시작·재시작할 수 없는 방으로 남는다(일반 방에서도 마찬가지였다).
     * 후보는 <b>사람만</b>이다 — 봇에게 넘기면 아무도 조작할 수 없는 것과 같다. 사람이 없으면
     * hostId를 비우고, 다음에 들어온 사람이 {@link #JOIN}에서 이어받는다.
     * <p>
     * 이어받을 사람은 playerId 오름차순 첫 번째다. 참가자가 hash라 입장 순서가 남지 않으므로
     * "먼저 온 사람"을 고를 수 없고, 대신 <b>누가 실행해도 같은 결과</b>가 나오는 규칙을 쓴다
     * (스냅샷 정렬도 playerId 기준이라 화면 맨 위 사람이 방장이 된다).
     */
    private static final DefaultRedisScript<Long> LEAVE = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
            if redis.call('HDEL', KEYS[2], ARGV[1]) == 0 then return -1 end
            redis.call('HDEL', KEYS[3], ARGV[1])
            redis.call('HDEL', KEYS[4], ARGV[1])
            local members = redis.call('HINCRBY', KEYS[1], 'members', -1)
            if members <= 0 and redis.call('HGET', KEYS[1], 'mode') ~= 'PARTY' then
                redis.call('DEL', KEYS[1])
                redis.call('DEL', KEYS[2])
                redis.call('DEL', KEYS[3])
                redis.call('DEL', KEYS[4])
                return 0
            end
            if redis.call('HGET', KEYS[1], 'hostId') == ARGV[1] then
                local heir = ''
                local remaining = redis.call('HKEYS', KEYS[2])
                table.sort(remaining)
                for i = 1, #remaining do
                    if redis.call('HEXISTS', KEYS[4], remaining[i]) == 0 then
                        heir = remaining[i]
                        break
                    end
                end
                redis.call('HSET', KEYS[1], 'hostId', heir)
            end
            return 1
            """, Long.class);
    /**
     * 방을 통째로 지운다. 게임 키는 참가자 수가 가변이라 KEYS로 미리 넘길 수 없어 스크립트 안에서
     * 조립한다({@link com.ssafy.yorr.game.repository.RedisGameCompletionStore}와 같은 규약).
     * 단일 Redis 전제 — 클러스터로 가면 참가자별 삭제를 애플리케이션으로 올려야 한다.
     */
    private static final DefaultRedisScript<Long> CLOSE = new DefaultRedisScript<>("""
            local gameId = redis.call('HGET', KEYS[1], 'gameId')
            if gameId then
                local players = redis.call('HKEYS', KEYS[2])
                for i = 1, #players do
                    redis.call('DEL', 'game:' .. gameId .. ':scoreboard:' .. players[i])
                    redis.call('DEL', 'game:' .. gameId .. ':score-submissions:' .. players[i])
                end
                redis.call('DEL', 'game:' .. gameId)
            end
            redis.call('DEL', KEYS[1])
            redis.call('DEL', KEYS[2])
            redis.call('DEL', KEYS[3])
            redis.call('DEL', KEYS[4])
            return 1
            """, Long.class);
    /**
     * 활동 시각을 갱신한다(sliding TTL). 방 키의 TTL을 처음부터 다시 세고, 함께 만료돼야 하는
     * 키들을 그 시각에 맞춘다. 게임 키는 참가자 수가 가변이라 스크립트 안에서 조립한다
     * ({@link #CLOSE}와 같은 규약 — 단일 Redis 전제).
     */
    static final DefaultRedisScript<Long> TOUCH = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
            redis.call('EXPIRE', KEYS[1], ARGV[1])
            local ttl = redis.call('PTTL', KEYS[1])
            if ttl <= 0 then return 1 end
            redis.call('PEXPIRE', KEYS[2], ttl)
            redis.call('PEXPIRE', KEYS[3], ttl)
            if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('PEXPIRE', KEYS[4], ttl) end
            local gameId = redis.call('HGET', KEYS[1], 'gameId')
            if gameId then
                redis.call('PEXPIRE', 'game:' .. gameId, ttl)
                local players = redis.call('HKEYS', KEYS[2])
                for i = 1, #players do
                    redis.call('PEXPIRE', 'game:' .. gameId .. ':scoreboard:' .. players[i], ttl)
                    redis.call('PEXPIRE', 'game:' .. gameId .. ':score-submissions:' .. players[i], ttl)
                end
            end
            return 1
            """, Long.class);
    static final DefaultRedisScript<Long> START = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
            if redis.call('HGET', KEYS[1], 'phase') ~= 'LOBBY' then return 0 end
            if redis.call('HLEN', KEYS[2]) < tonumber(ARGV[3]) then return 0 end
            local gameCode = redis.call('HGET', KEYS[1], 'gameCode')
            if not gameCode then return 0 end
            redis.call('HSET', KEYS[1], 'phase', 'PLAYING', 'gameId', ARGV[1])
            redis.call('HSET', KEYS[3], 'roomCode', ARGV[2], 'gameCode', gameCode)
            local ttl = redis.call('PTTL', KEYS[1])
            if ttl > 0 then
                redis.call('PEXPIRE', KEYS[3], ttl)
                if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('PEXPIRE', KEYS[4], ttl) end
            end
            return 1
            """, Long.class);
    static final DefaultRedisScript<Long> ROLLBACK_START = new DefaultRedisScript<>("""
            if redis.call('HGET', KEYS[1], 'phase') ~= 'PLAYING' then return 0 end
            if redis.call('HGET', KEYS[1], 'gameId') ~= ARGV[1] then return 0 end
            redis.call('HSET', KEYS[1], 'phase', 'LOBBY')
            redis.call('HDEL', KEYS[1], 'gameId')
            redis.call('DEL', KEYS[2])
            return 1
            """, Long.class);

    /**
     * 끝난 게임을 대기실로 되돌린다. FINISHED에서만 통과하므로 진행 중인 게임을 되돌릴 수는 없다.
     * <p>
     * 총점 해시(scores)를 0으로 되돌리는 게 핵심이다 — 이건 gameId가 아니라 방에 매달려 있어서
     * 초기화하지 않으면 다음 게임 순위에 지난 게임 점수가 그대로 얹힌다.
     * 점수판(game:{id}:scoreboard:*)은 gameId별로 따로 쌓이므로 지우지 않는다(결과 조회용으로 남는다).
     */
    static final DefaultRedisScript<Long> RETURN_TO_LOBBY = new DefaultRedisScript<>("""
            if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
            if redis.call('HGET', KEYS[1], 'phase') ~= 'FINISHED' then return 0 end
            redis.call('HSET', KEYS[1], 'phase', 'LOBBY')
            redis.call('HDEL', KEYS[1], 'gameId')
            local players = redis.call('HKEYS', KEYS[2])
            for i = 1, #players do
                redis.call('HSET', KEYS[3], players[i], '0')
            end
            local ttl = redis.call('PTTL', KEYS[1])
            if ttl > 0 then
                redis.call('PEXPIRE', KEYS[3], ttl)
                if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('PEXPIRE', KEYS[4], ttl) end
            end
            return 1
            """, Long.class);

    private final RedisTemplate<String, String> redisTemplate;

    @Override
    public JoinResult join(String roomCode, UserIdentity user, String sessionToken) {
        Long result = redisTemplate.execute(JOIN, List.of(RoomRedisKeys.roomKey(roomCode),
                RoomRedisKeys.playersKey(roomCode), RoomRedisKeys.scoresKey(roomCode),
                RoomRedisKeys.botsKey(roomCode)), user.userId(), user.nickname());
        if (Long.valueOf(0).equals(result)) throw new IllegalArgumentException("room_not_found");
        if (Long.valueOf(2).equals(result)) throw new IllegalStateException("game_started");
        if (Long.valueOf(3).equals(result)) throw new IllegalStateException("room_full");
        return new JoinResult(user.userId(), sessionToken, getSnapshot(roomCode));
    }

    @Override
    public boolean leave(String roomCode, String playerId) {
        Long result = redisTemplate.execute(LEAVE, List.of(RoomRedisKeys.roomKey(roomCode),
                RoomRedisKeys.playersKey(roomCode), RoomRedisKeys.scoresKey(roomCode),
                RoomRedisKeys.botsKey(roomCode)), playerId);
        return result != null && result >= 0;
    }

    @Override
    public void close(String roomCode) {
        redisTemplate.execute(CLOSE, List.of(RoomRedisKeys.roomKey(roomCode),
                RoomRedisKeys.playersKey(roomCode), RoomRedisKeys.scoresKey(roomCode),
                RoomRedisKeys.botsKey(roomCode)));
    }

    @Override
    public void touch(String roomCode) {
        redisTemplate.execute(TOUCH, List.of(RoomRedisKeys.roomKey(roomCode),
                        RoomRedisKeys.playersKey(roomCode), RoomRedisKeys.scoresKey(roomCode),
                        RoomRedisKeys.botsKey(roomCode)),
                String.valueOf(RoomCreateService.ROOM_TTL.toSeconds()));
    }

    @Override
    public RoomSnapshot getSnapshot(String roomCode) {
        Map<Object, Object> room = redisTemplate.<Object, Object>opsForHash().entries(RoomRedisKeys.roomKey(roomCode));
        if (room.isEmpty()) return RoomSnapshot.notFound(roomCode);
        Map<Object, Object> players = redisTemplate.<Object, Object>opsForHash().entries(RoomRedisKeys.playersKey(roomCode));
        Map<Object, Object> scores = redisTemplate.<Object, Object>opsForHash().entries(RoomRedisKeys.scoresKey(roomCode));
        Map<Object, Object> bots = redisTemplate.<Object, Object>opsForHash().entries(RoomRedisKeys.botsKey(roomCode));
        List<RoomPlayerSnapshot> snapshots = players.entrySet().stream()
                .map(player -> {
                    String playerId = (String) player.getKey();
                    boolean bot = bots.containsKey(playerId);
                    return new RoomPlayerSnapshot(
                            playerId,
                            (String) player.getValue(),
                            Integer.parseInt((String) scores.getOrDefault(player.getKey(), "0")),
                            bot ? ParticipantKind.BOT : ParticipantKind.HUMAN
                    );
                })
                .sorted(Comparator.comparing(RoomPlayerSnapshot::playerId))
                .toList();
        return new RoomSnapshot(roomCode, (String) room.get("gameCode"), (String) room.get("gameId"),
                (String) room.get("hostId"),
                RoomPhase.valueOf((String) room.get("phase")), Integer.parseInt((String) room.get("capacity")), snapshots);
    }

    public GameStartResponse startGame(String roomCode) {
        return startGame(roomCode, 1);
    }

    public GameStartResponse startGame(String roomCode, int minPlayers) {
        if (minPlayers < 1) throw new IllegalArgumentException("invalid_min_players");
        String gameId = UUID.randomUUID().toString();
        Long result = redisTemplate.execute(START, List.of(
                RoomRedisKeys.roomKey(roomCode),
                RoomRedisKeys.playersKey(roomCode),
                RoomRedisKeys.gameKey(gameId),
                RoomRedisKeys.botsKey(roomCode)
        ), gameId, roomCode, String.valueOf(minPlayers));
        if (!Long.valueOf(1).equals(result)) throw new IllegalStateException("game_not_ready");
        return new GameStartResponse(gameId, getSnapshot(roomCode));
    }

    public boolean rollbackStart(String roomCode, String gameId) {
        Long result = redisTemplate.execute(ROLLBACK_START, List.of(
                RoomRedisKeys.roomKey(roomCode),
                RoomRedisKeys.gameKey(gameId)
        ), gameId);
        return Long.valueOf(1).equals(result);
    }

    /** @return 이 호출이 실제로 대기실로 되돌렸는지. 이미 대기실이면 false(멱등). */
    public boolean returnToLobby(String roomCode) {
        Long result = redisTemplate.execute(RETURN_TO_LOBBY, List.of(RoomRedisKeys.roomKey(roomCode),
                RoomRedisKeys.playersKey(roomCode), RoomRedisKeys.scoresKey(roomCode),
                RoomRedisKeys.botsKey(roomCode)));
        return Long.valueOf(1).equals(result);
    }

    /**
     * 이 방이 파티 방인지. 없는 방·mode가 없는 옛 방은 일반 방으로 본다.
     * <p>
     * {@link #LEAVE}가 "마지막 참가자가 빠져도 방을 지우지 않는다"를 판단하는 근거가 이 값이다.
     * 스크립트 안에서는 {@code mode}를 직접 읽으므로, 이 메서드는 그 값이 실제로 적혔는지
     * 밖에서 확인하는 창구다({@link com.ssafy.yorr.room.dto.RoomMode}).
     */
    public boolean isPartyRoom(String roomCode) {
        Object mode = redisTemplate.<Object, Object>opsForHash().get(RoomRedisKeys.roomKey(roomCode), "mode");
        return RoomMode.PARTY.name().equals(mode);
    }

    public RoomSnapshot getGameSnapshot(String gameId) {
        Object roomCode = redisTemplate.<Object, Object>opsForHash().get(RoomRedisKeys.gameKey(gameId), "roomCode");
        return roomCode == null ? RoomSnapshot.notFound(null) : getSnapshot((String) roomCode);
    }
}
