package com.ssafy.yorr.game.pingpong;

import com.ssafy.yorr.game.round.application.GameCompletionService;
import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import com.ssafy.yorr.room.RoomRedisKeys;
import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.room.dto.ParticipantKind;
import com.ssafy.yorr.room.service.RoomValidationService;
import com.ssafy.yorr.ws.RealtimeRoomSnapshotService;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.RoomPhase;
import com.ssafy.yorr.ws.dto.RoomPlayerLeftPayload;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import com.ssafy.yorr.ws.dto.StateSyncPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

import static com.ssafy.yorr.game.module.GameWsTypes.type;
import static com.ssafy.yorr.game.pingpong.PingPongGameModule.CODE;

@Service
public class PingPongGameService {

    private final RedisPingPongStateStore states;
    private final RoundDeadlineScheduler scheduler;
    private final RoomBroadcaster broadcaster;
    private final RealtimeRoomSnapshotService realtimeSnapshots;
    private final RoomSessionRegistry sessions;
    private final GameCompletionService completion;
    private final StringRedisTemplate redis;
    private final RoomValidationService rooms;

    public PingPongGameService(
            RedisPingPongStateStore states,
            RoundDeadlineScheduler scheduler,
            RoomBroadcaster broadcaster,
            RealtimeRoomSnapshotService realtimeSnapshots,
            RoomSessionRegistry sessions,
            GameCompletionService completion,
            StringRedisTemplate redis,
            RoomValidationService rooms
    ) {
        this.states = states;
        this.scheduler = scheduler;
        this.broadcaster = broadcaster;
        this.realtimeSnapshots = realtimeSnapshots;
        this.sessions = sessions;
        this.completion = completion;
        this.redis = redis;
        this.rooms = rooms;
    }

    public void start(String roomId, GameStartResponse game) {
        List<String> players = game.snapshot().players().stream()
                .filter(player -> player.kind() == ParticipantKind.HUMAN)
                .sorted(Comparator.comparing(player -> !player.playerId().equals(game.snapshot().hostId())))
                .map(player -> player.playerId())
                .toList();
        if (players.size() != 2) throw new IllegalStateException("ping_pong_requires_two_players");

        PingPongState state = PingPongRules.initial(players, System.currentTimeMillis());
        states.initialize(roomId, state);
        sessions.markPhase(roomId, RoomPhase.PLAYING);
        broadcast(roomId, state, true);
        schedule(roomId, state);
    }

    public void swing(String roomId, String playerId, PingPongSwingPayload payload) {
        if (payload == null || payload.inputSeq() < 0) throw new IllegalArgumentException("invalid_ping_pong_swing");
        // 업링크 지연만큼 되감아 "친 순간"으로 판정한다. 되감기 폭은 PingPongRules 가 묶는다.
        long swungAt = PingPongRules.judgedAt(System.currentTimeMillis(), payload.clientTs());
        states.mutate(roomId, current -> PingPongRules.swing(
                        current, playerId, payload.inputSeq(), swungAt, randomTarget()))
                .ifPresent(next -> changed(roomId, next));
    }

    public void ready(String roomId, String playerId) {
        long now = System.currentTimeMillis();
        states.mutate(roomId, current -> PingPongRules.ready(current, playerId, now))
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
        boolean preparing = states.find(roomId)
                .map(state -> state.phase() == PingPongState.Phase.PREPARING)
                .orElse(false);
        RoomSessionRegistry.Member removed = sessions.removePlayer(roomId, playerId);
        boolean removedFromRoom = rooms.leave(roomId, playerId);
        if (removed != null || removedFromRoom) {
            broadcaster.broadcast(roomId, WsEnvelope.of("room.player_left",
                            new RoomPlayerLeftPayload(playerId))
                    .withRoomId(roomId));
        }
        if (preparing) {
            cancelPreparation(roomId);
            return;
        }
        long now = System.currentTimeMillis();
        states.mutate(roomId, current -> PingPongRules.forfeit(current, playerId, now))
                .ifPresent(next -> changed(roomId, next));
    }

    private void cancelPreparation(String roomId) {
        scheduler.cancelRoom(roomId);
        states.remove(roomId);
        rooms.cancelActiveGame(roomId);
        sessions.markPhase(roomId, RoomPhase.WAITING);
        broadcaster.broadcast(roomId, WsEnvelope.of(
                type(CODE, "state.sync"), new StateSyncPayload(realtimeSnapshots.snapshot(roomId))
        ).withRoomId(roomId));
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

    private void timeout(String roomId, int expectedVersion) {
        long now = System.currentTimeMillis();
        states.mutate(roomId, current -> {
                    if (current.version() != expectedVersion || current.finished()) return null;
                    if (current.phase() == PingPongState.Phase.COUNTDOWN) {
                        return PingPongRules.serve(current, now, randomTarget());
                    }
                    return PingPongRules.expire(current, now);
                })
                .ifPresent(next -> changed(roomId, next));
    }

    private void changed(String roomId, PingPongState state) {
        if (state.finished()) {
            scheduler.cancelRoom(roomId);
            state.scores().forEach((playerId, score) -> {
                // A forfeiting player is removed from the room before this callback runs.
                // Do not recreate that player's stale score hash entry.
                if (Boolean.TRUE.equals(redis.opsForHash()
                        .hasKey(RoomRedisKeys.playersKey(roomId), playerId))) {
                    redis.opsForHash().put(RoomRedisKeys.scoresKey(roomId), playerId, String.valueOf(score));
                }
            });
            completion.finishIfComplete(roomId, true);
            broadcast(roomId, state, true);
            return;
        }
        broadcast(roomId, state, state.phase() == PingPongState.Phase.COUNTDOWN);
        schedule(roomId, state);
    }

    private void schedule(String roomId, PingPongState state) {
        if (state.finished() || state.nextActionAt() <= 0) return;
        scheduler.schedule(roomId, state.version(), Instant.ofEpochMilli(state.nextActionAt()),
                () -> timeout(roomId, state.version()));
    }

    private void broadcast(String roomId, PingPongState state, boolean includeRoomSnapshot) {
        broadcaster.broadcast(roomId, WsEnvelope.of(type(CODE, "state"), state).withRoomId(roomId));
        if (includeRoomSnapshot) {
            broadcaster.broadcast(roomId, WsEnvelope.of(
                    type(CODE, "state.sync"), new StateSyncPayload(snapshot(roomId, state))
            ).withRoomId(roomId));
        }
    }

    private RoomSnapshot snapshot(String roomId, PingPongState state) {
        RoomSnapshot room = realtimeSnapshots.snapshot(roomId);
        return new RoomSnapshot(room.roomId(), room.gameCode(), room.phase(), room.hostId(), room.players(),
                state, room.capacity());
    }

    private static double randomTarget() {
        return ThreadLocalRandom.current().nextDouble(0.15, 0.85);
    }
}
