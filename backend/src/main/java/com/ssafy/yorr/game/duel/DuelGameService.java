package com.ssafy.yorr.game.duel;

import com.ssafy.yorr.game.round.application.GameCompletionService;
import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.room.dto.ParticipantKind;
import com.ssafy.yorr.ws.RealtimeRoomSnapshotService;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.RoomPhase;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import com.ssafy.yorr.ws.dto.StateSyncPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

import static com.ssafy.yorr.game.duel.DuelGameModule.CODE;
import static com.ssafy.yorr.game.module.GameWsTypes.type;

/**
 * 결투 진행의 권위. 신호등을 언제 초록으로 바꿀지, 라운드를 언제 넘길지 전부 서버가
 * 스케줄러로 잡는다 — 두 클라이언트가 같은 순간에 같은 신호를 보게 하려면 시각의 주인이
 * 하나여야 한다.
 */
@Service
public class DuelGameService {

    private final RedisDuelStateStore states;
    private final RoundDeadlineScheduler scheduler;
    private final RoomBroadcaster broadcaster;
    private final RealtimeRoomSnapshotService realtimeSnapshots;
    private final RoomSessionRegistry sessions;
    private final GameCompletionService completion;
    private final StringRedisTemplate redis;

    public DuelGameService(
            RedisDuelStateStore states,
            RoundDeadlineScheduler scheduler,
            RoomBroadcaster broadcaster,
            RealtimeRoomSnapshotService realtimeSnapshots,
            RoomSessionRegistry sessions,
            GameCompletionService completion,
            StringRedisTemplate redis
    ) {
        this.states = states;
        this.scheduler = scheduler;
        this.broadcaster = broadcaster;
        this.realtimeSnapshots = realtimeSnapshots;
        this.sessions = sessions;
        this.completion = completion;
        this.redis = redis;
    }

    public void start(String roomId, GameStartResponse game) {
        List<String> players = game.snapshot().players().stream()
                .filter(player -> player.kind() == ParticipantKind.HUMAN)
                .sorted(Comparator.comparing(player -> !player.playerId().equals(game.snapshot().hostId())))
                .map(player -> player.playerId())
                .toList();
        if (players.size() != 2) throw new IllegalStateException("duel_requires_two_players");

        DuelState state = DuelRules.initial(players, System.currentTimeMillis(), randomWait());
        states.initialize(roomId, state);
        sessions.markPhase(roomId, RoomPhase.PLAYING);
        broadcast(roomId, state, true);
        schedule(roomId, state);
    }

    public void draw(String roomId, String playerId, DuelDrawPayload payload) {
        if (payload == null || payload.inputSeq() < 0) throw new IllegalArgumentException("invalid_duel_draw");
        long now = System.currentTimeMillis();
        states.mutate(roomId, current -> DuelRules.draw(
                        current, playerId, payload.inputSeq(), payload.reactionMs(), now))
                .ifPresent(next -> changed(roomId, next));
    }

    public RoomSnapshot reconnect(String roomId) {
        return states.find(roomId)
                .map(state -> snapshot(roomId, state))
                .orElseGet(() -> realtimeSnapshots.snapshot(roomId));
    }

    public void resume(String roomId) {
        states.find(roomId).filter(state -> !state.finished()).ifPresent(state -> schedule(roomId, state));
    }

    public void pause(String roomId) {
        scheduler.cancelRoom(roomId);
    }

    public void removePlayer(String roomId, String playerId) {
        long now = System.currentTimeMillis();
        states.mutate(roomId, current -> DuelRules.forfeit(current, playerId, now))
                .ifPresent(next -> changed(roomId, next));
    }

    public void reset(String roomId) {
        scheduler.cancelRoom(roomId);
        states.remove(roomId);
        sessions.markPhase(roomId, RoomPhase.WAITING);
        broadcaster.broadcast(roomId, WsEnvelope.of(
                type(CODE, "state.sync"), new StateSyncPayload(realtimeSnapshots.snapshot(roomId))
        ).withRoomId(roomId));
    }

    public void close(String roomId) {
        scheduler.cancelRoom(roomId);
        states.remove(roomId);
    }

    public boolean hasState(String roomId) {
        return states.find(roomId).isPresent();
    }

    /** 대기 → 신호 · 신호 → 무효 · 결과 → 다음 라운드(또는 종료)를 잇는 유일한 시계다. */
    private void timeout(String roomId, int expectedVersion) {
        long now = System.currentTimeMillis();
        states.mutate(roomId, current -> {
                    if (current.version() != expectedVersion || current.finished()) return null;
                    return switch (current.phase()) {
                        case WAITING -> DuelRules.signal(current, now);
                        case SIGNAL -> DuelRules.expire(current, now);
                        case RESULT -> current.lastRound() != null && current.lastRound().over()
                                ? DuelRules.finish(current)
                                : DuelRules.nextRound(current, now, randomWait());
                        case FINISHED -> null;
                    };
                })
                .ifPresent(next -> changed(roomId, next));
    }

    private void changed(String roomId, DuelState state) {
        if (state.finished()) {
            scheduler.cancelRoom(roomId);
            // 남은 총알이 그대로 점수다 — 살아남은 쪽만 1발 이상 들고 끝난다.
            state.hp().forEach((playerId, remaining) -> {
                // 방을 떠난 플레이어는 이 콜백보다 먼저 명단에서 지워진다.
                // 사라진 참가자의 점수 항목을 되살리지 않는다.
                if (Boolean.TRUE.equals(redis.opsForHash()
                        .hasKey(RoomRedisKeys.playersKey(roomId), playerId))) {
                    redis.opsForHash().put(RoomRedisKeys.scoresKey(roomId), playerId, String.valueOf(remaining));
                }
            });
            completion.finishIfComplete(roomId, true);
            broadcast(roomId, state, true);
            return;
        }
        broadcast(roomId, state, state.phase() == DuelState.Phase.WAITING);
        schedule(roomId, state);
    }

    private void schedule(String roomId, DuelState state) {
        if (state.finished() || state.nextActionAt() <= 0) return;
        scheduler.schedule(roomId, state.version(), Instant.ofEpochMilli(state.nextActionAt()),
                () -> timeout(roomId, state.version()));
    }

    private void broadcast(String roomId, DuelState state, boolean includeRoomSnapshot) {
        broadcaster.broadcast(roomId, WsEnvelope.of(type(CODE, "state"), state).withRoomId(roomId));
        if (includeRoomSnapshot) {
            broadcaster.broadcast(roomId, WsEnvelope.of(
                    type(CODE, "state.sync"), new StateSyncPayload(snapshot(roomId, state))
            ).withRoomId(roomId));
        }
    }

    private RoomSnapshot snapshot(String roomId, DuelState state) {
        RoomSnapshot room = realtimeSnapshots.snapshot(roomId);
        return new RoomSnapshot(room.roomId(), room.gameCode(), room.phase(), room.hostId(), room.players(),
                state, room.capacity());
    }

    private static long randomWait() {
        return ThreadLocalRandom.current().nextLong(DuelRules.MIN_WAIT_MILLIS, DuelRules.MAX_WAIT_MILLIS);
    }
}
