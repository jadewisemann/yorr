package com.ssafy.yorr.game.teamyacht;

import com.ssafy.yorr.game.round.application.GameCompletionService;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

import static com.ssafy.yorr.game.module.GameWsTypes.type;
import static com.ssafy.yorr.game.teamyacht.TeamYachtGameModule.CODE;

/**
 * 조별과제 야트 진행의 권위(S15P11A406-209).
 * <p>
 * 규칙은 {@link TeamYachtRules}가, 순서 보장은 {@link RedisTeamYachtStateStore}의 방 락이 맡는다.
 * 여기는 "바뀐 상태를 누구에게 어떤 모양으로 보내는가"만 결정한다 — 그리고 그 모양은
 * <b>사람마다 다르다</b>. 앞 주자가 버린 주사위 눈은 방송이 아니라 개인 메시지로만 나간다
 * ({@link TeamYachtView}). 방 전체 방송(state.sync)에는 게임 진행 상태를 싣지 않는다.
 */
@Service
public class TeamYachtGameService {

    private static final Logger log = LoggerFactory.getLogger(TeamYachtGameService.class);

    private final RedisTeamYachtStateStore states;
    private final RoomBroadcaster broadcaster;
    private final RealtimeRoomSnapshotService realtimeSnapshots;
    private final RoomSessionRegistry sessions;
    private final GameCompletionService completion;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public TeamYachtGameService(
            RedisTeamYachtStateStore states,
            RoomBroadcaster broadcaster,
            RealtimeRoomSnapshotService realtimeSnapshots,
            RoomSessionRegistry sessions,
            GameCompletionService completion,
            StringRedisTemplate redis,
            ObjectMapper objectMapper
    ) {
        this.states = states;
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
        if (players.size() != TeamYachtRules.SEATS) {
            throw new IllegalStateException("team_yacht_requires_three_players");
        }

        states.remove(roomId);
        TeamYachtState state = TeamYachtRules.initial(players, ThreadLocalRandom.current().nextInt() & 0xFFFFFFFFL);
        states.initialize(roomId, state);
        sessions.markPhase(roomId, RoomPhase.PLAYING);
        broadcastRoom(roomId);
        sendViews(roomId, state);
    }

    public void roll(String roomId, String playerId) {
        states.mutate(roomId, current -> TeamYachtRules.roll(current, playerId))
                .ifPresent(next -> changed(roomId, next));
    }

    public void keep(String roomId, String playerId, TeamYachtPayloads.Keep payload) {
        if (payload == null) throw new IllegalArgumentException("invalid_keep_payload");
        states.mutate(roomId, current -> TeamYachtRules.keep(current, playerId, payload.keep()))
                .ifPresent(next -> changed(roomId, next));
    }

    public void vote(String roomId, String playerId, TeamYachtPayloads.Vote payload) {
        if (payload == null || payload.category() == null) throw new IllegalArgumentException("invalid_vote_payload");
        states.mutate(roomId, current -> TeamYachtRules.vote(current, playerId, payload.category()))
                .ifPresent(next -> changed(roomId, next));
    }

    /** 진행 중 재접속. 이 응답은 그 플레이어에게만 가므로 개인 시야를 그대로 싣는다. */
    public RoomSnapshot reconnect(String roomId, String playerId) {
        RoomSnapshot room = realtimeSnapshots.snapshot(roomId);
        return states.find(roomId)
                .map(state -> new RoomSnapshot(room.roomId(), room.gameCode(), room.phase(), room.hostId(),
                        room.players(), TeamYachtView.of(state, playerId), room.capacity()))
                .orElse(room);
    }

    public void removePlayer(String roomId, String playerId) {
        states.find(roomId)
                .filter(state -> !state.finished() && state.seats().contains(playerId))
                .flatMap(ignored -> states.mutate(roomId, TeamYachtRules::forfeit))
                .ifPresent(next -> changed(roomId, next));
    }

    public void reset(String roomId) {
        states.remove(roomId);
        sessions.markPhase(roomId, RoomPhase.WAITING);
        broadcastRoom(roomId);
    }

    public void close(String roomId) {
        states.remove(roomId);
    }

    public boolean hasState(String roomId) {
        return states.find(roomId).isPresent();
    }

    private void changed(String roomId, TeamYachtState state) {
        if (state.finished()) {
            // 점수판이 하나뿐이라 세 사람의 총점이 같다 — 순위도 공동 1위다.
            int total = TeamYachtRules.board(state.recorded()).total();
            for (String playerId : state.seats()) {
                if (Boolean.TRUE.equals(redis.opsForHash().hasKey(RoomRedisKeys.playersKey(roomId), playerId))) {
                    redis.opsForHash().put(RoomRedisKeys.scoresKey(roomId), playerId, String.valueOf(total));
                }
            }
            sendViews(roomId, state);
            // 종료 방송(game.over)·순위 저장·phase 전이는 공용부가 한다. 중복 방송도 여기서 막힌다.
            completion.finishIfComplete(roomId, true);
            log.info("team_yacht finished: room={} total={}", roomId, total);
            return;
        }
        sendViews(roomId, state);
    }

    /** 사람마다 다른 시야를 각자에게만 보낸다. 방 전체 방송으로는 진행 상태가 나가지 않는다. */
    private void sendViews(String roomId, TeamYachtState state) {
        for (String playerId : state.seats()) {
            RoomSessionRegistry.Member member = sessions.find(roomId, playerId);
            WebSocketSession session = member == null ? null : member.session();
            if (session == null || !session.isOpen()) continue;
            WsEnvelope<TeamYachtView> envelope = WsEnvelope
                    .of(type(CODE, "state"), TeamYachtView.of(state, playerId))
                    .withRoomId(roomId);
            try {
                String json = objectMapper.writeValueAsString(envelope);
                synchronized (session) {
                    session.sendMessage(new TextMessage(json));
                }
            } catch (Exception exception) {
                // 죽은 소켓 하나가 나머지 두 명의 화면을 멈추게 하지 않는다.
                log.debug("team_yacht state 전송 실패: room={} player={}", roomId, playerId, exception);
            }
        }
    }

    private void broadcastRoom(String roomId) {
        broadcaster.broadcast(roomId, WsEnvelope.of(
                type(CODE, "state.sync"), new StateSyncPayload(realtimeSnapshots.snapshot(roomId))
        ).withRoomId(roomId));
    }
}
