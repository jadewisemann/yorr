package com.ssafy.yorr.game.liars;

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
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Random;

import static com.ssafy.yorr.game.liars.LiarsGameModule.CODE;
import static com.ssafy.yorr.game.module.GameWsTypes.type;

/**
 * 라이어스 진행의 권위. 주사위를 굴리는 것도, 챌린지를 판정하는 것도 여기(서버)뿐이다.
 *
 * <p><b>이 서비스의 핵심 책임은 두 갈래로 나가는 것이다.</b>
 * <ul>
 *   <li>방 전체 → {@code game.liars.state}에 {@link LiarsState#view()}(손패 없음)</li>
 *   <li>각자에게 따로 → {@code game.liars.hand}에 <b>자기 손패만</b></li>
 * </ul>
 * 남의 눈이 브로드캐스트에 실리는 건 챌린지로 공개되는 {@code lastReveal.hands} 하나뿐이다.
 */
@Service
public class LiarsGameService {

    private final RedisLiarsStateStore states;
    private final RoundDeadlineScheduler scheduler;
    private final RoomBroadcaster broadcaster;
    private final RealtimeRoomSnapshotService realtimeSnapshots;
    private final RoomSessionRegistry sessions;
    private final GameCompletionService completion;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public LiarsGameService(
            RedisLiarsStateStore states,
            RoundDeadlineScheduler scheduler,
            RoomBroadcaster broadcaster,
            RealtimeRoomSnapshotService realtimeSnapshots,
            RoomSessionRegistry sessions,
            GameCompletionService completion,
            StringRedisTemplate redis,
            ObjectMapper objectMapper
    ) {
        this.states = states;
        this.scheduler = scheduler;
        this.broadcaster = broadcaster;
        this.realtimeSnapshots = realtimeSnapshots;
        this.sessions = sessions;
        this.completion = completion;
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    public void start(String roomId, GameStartResponse game) {
        List<String> players = game.snapshot().players().stream()
                .filter(player -> player.kind() == ParticipantKind.HUMAN)
                .sorted(Comparator.comparing(player -> !player.playerId().equals(game.snapshot().hostId())))
                .map(player -> player.playerId())
                .toList();
        if (players.size() < 2) throw new IllegalStateException("liars_requires_two_players");

        LiarsState state = LiarsRules.initial(players, random(), System.currentTimeMillis());
        states.initialize(roomId, state);
        sessions.markPhase(roomId, RoomPhase.PLAYING);
        broadcast(roomId, state, true);
        sendHands(roomId, state);
    }

    public void bid(String roomId, String playerId, LiarsBidPayload payload) {
        if (payload == null) throw new IllegalArgumentException("invalid_liars_bid");
        states.mutate(roomId, current -> LiarsRules.bid(current, playerId, payload.quantity(), payload.face()))
                .ifPresent(next -> changed(roomId, next));
    }

    public void challenge(String roomId, String playerId) {
        long now = System.currentTimeMillis();
        states.mutate(roomId, current -> LiarsRules.challenge(current, playerId, now))
                .ifPresent(next -> changed(roomId, next));
    }

    /**
     * 재접속. 방 스냅샷을 돌려주는 것만으로는 부족하다 — 손패는 개인에게만 갔으므로
     * 돌아온 사람에게 자기 손패를 다시 보내야 판을 이어서 볼 수 있다.
     */
    public RoomSnapshot reconnect(String roomId, String playerId) {
        return states.find(roomId)
                .map(state -> {
                    sendHand(roomId, playerId, state);
                    return snapshot(roomId, state);
                })
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
        states.mutate(roomId, current -> LiarsRules.forfeit(current, playerId, random(), now))
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

    /** 공개 판정 → 다음 라운드(또는 종료)를 잇는 유일한 시계. */
    private void timeout(String roomId, int expectedVersion) {
        long now = System.currentTimeMillis();
        states.mutate(roomId, current -> {
                    if (current.version() != expectedVersion) return null;
                    return LiarsRules.resolveReveal(current, random(), now);
                })
                .ifPresent(next -> changed(roomId, next));
    }

    private void changed(String roomId, LiarsState state) {
        if (state.finished()) {
            scheduler.cancelRoom(roomId);
            writeScores(roomId, state);
            completion.finishIfComplete(roomId, true);
            broadcast(roomId, state, true);
            return;
        }
        broadcast(roomId, state, false);
        // 새 라운드가 시작됐다 = 손패가 새로 굴려졌다. 공개 판정 중에는 보낼 게 없다.
        if (state.phase() == LiarsState.Phase.BIDDING) sendHands(roomId, state);
        schedule(roomId, state);
    }

    /** 남은 주사위 개수가 그대로 점수다 — 마지막까지 지킨 사람이 1위다. */
    private void writeScores(String roomId, LiarsState state) {
        state.dice().forEach((playerId, remaining) -> {
            // 방을 떠난 사람의 점수 항목을 되살리지 않는다(탁구·결투와 같은 이유).
            if (Boolean.TRUE.equals(redis.opsForHash().hasKey(RoomRedisKeys.playersKey(roomId), playerId))) {
                redis.opsForHash().put(RoomRedisKeys.scoresKey(roomId), playerId, String.valueOf(remaining));
            }
        });
    }

    private void schedule(String roomId, LiarsState state) {
        if (state.finished() || state.nextActionAt() <= 0) return;
        scheduler.schedule(roomId, state.version(), Instant.ofEpochMilli(state.nextActionAt()),
                () -> timeout(roomId, state.version()));
    }

    /** ⚠️ 방송에는 {@link LiarsState#view()}만 싣는다. state를 그대로 넘기면 손패가 전원에게 나간다. */
    private void broadcast(String roomId, LiarsState state, boolean includeRoomSnapshot) {
        broadcaster.broadcast(roomId, WsEnvelope.of(type(CODE, "state"), state.view()).withRoomId(roomId));
        if (includeRoomSnapshot) {
            broadcaster.broadcast(roomId, WsEnvelope.of(
                    type(CODE, "state.sync"), new StateSyncPayload(snapshot(roomId, state))
            ).withRoomId(roomId));
        }
    }

    private void sendHands(String roomId, LiarsState state) {
        state.hands().keySet().forEach(playerId -> sendHand(roomId, playerId, state));
    }

    private void sendHand(String roomId, String playerId, LiarsState state) {
        List<Integer> hand = state.hands().get(playerId);
        if (hand == null) return;
        sendPrivate(roomId, playerId, WsEnvelope.of(
                type(CODE, "hand"), new LiarsHandPayload(state.round(), hand)
        ).withRoomId(roomId));
    }

    /**
     * 한 사람의 소켓에만 보낸다. 브로드캐스터에는 이런 경로가 없다 — 지금까지의 게임은
     * 숨길 것이 없었기 때문이다. 죽은 소켓은 조용히 넘긴다(재접속 때 다시 받는다).
     */
    private void sendPrivate(String roomId, String playerId, WsEnvelope<?> message) {
        RoomSessionRegistry.Member member = sessions.find(roomId, playerId);
        WebSocketSession session = member == null ? null : member.session();
        if (session == null || !session.isOpen()) return;
        try {
            TextMessage frame = new TextMessage(objectMapper.writeValueAsString(message));
            synchronized (session) {
                session.sendMessage(frame);
            }
        } catch (Exception exception) {
            // 손패 한 통이 판 전체를 깨지 않게 한다. 못 받은 사람은 재접속으로 복구된다.
        }
    }

    private RoomSnapshot snapshot(String roomId, LiarsState state) {
        RoomSnapshot room = realtimeSnapshots.snapshot(roomId);
        return new RoomSnapshot(room.roomId(), room.gameCode(), room.phase(), room.hostId(), room.players(),
                state.view(), room.capacity());
    }

    private static Random random() {
        return new Random();
    }
}
