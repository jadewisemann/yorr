package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import com.ssafy.yorr.game.round.domain.RoundCompletion;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.room.dto.ParticipantKind;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.PlayerStatus;
import com.ssafy.yorr.ws.dto.RoomPlayerLeftPayload;
import com.ssafy.yorr.ws.dto.RoundEndPayload;
import com.ssafy.yorr.ws.dto.RoundStartPayload;
import com.ssafy.yorr.ws.dto.ScoreUpdatePayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

import static com.ssafy.yorr.game.yacht.YachtDiceWsTypes.type;

@Service
public class RoundTimerService {

    public static final Duration ROUND_DURATION = Duration.ofSeconds(25);
    /**
     * 강제 진행을 마감 시각보다 이만큼 늦춘다.
     * <p>
     * 마감 처리 자체는 서버가 한다({@link RoundTimeoutResolver}). 다만 플레이어가 마감 직전에
     * 누른 round.submit이 아직 날아오는 중일 수 있고, 그 요청이 NOT_YOUR_TURN으로 거절되면
     * 본인이 고른 족보 대신 서버가 고른 족보가 기록된다. 왕복 시간과 클라 시계 오차를 흡수할
     * 만큼만 준다.
     */
    static final Duration EXPIRY_GRACE = Duration.ofSeconds(1);

    /** 오프라인 상태로 자기 턴을 이 횟수째 맞으면 스킵 대신 자동 퇴장시킨다. */
    static final int MAX_OFFLINE_TURNS = 2;

    private static final Logger log = LoggerFactory.getLogger(RoundTimerService.class);

    private final RoundTimeoutResolver timeoutResolver;
    private final RoundDeadlineScheduler deadlineScheduler;
    private final RoomBroadcaster broadcaster;
    private final GameCompletionService gameCompletionService;
    private final RoundSynchronizationService roundSynchronizationService;
    private final RoomSessionRegistry registry;
    private final RoomService roomService;
    private final ApplicationEventPublisher eventPublisher;
    private final Clock clock;
    private final Map<String, ActiveDeadline> activeDeadlines = new ConcurrentHashMap<>();
    // roomId -> (playerId -> 오프라인으로 맞은 자기 턴 수). 재접속하면 지운다.
    private final Map<String, Map<String, Integer>> offlineMisses = new ConcurrentHashMap<>();

    @Autowired
    public RoundTimerService(
            RoundTimeoutResolver timeoutResolver,
            RoundDeadlineScheduler deadlineScheduler,
            RoomBroadcaster broadcaster,
            GameCompletionService gameCompletionService,
            RoundSynchronizationService roundSynchronizationService,
            RoomSessionRegistry registry,
            RoomService roomService,
            ApplicationEventPublisher eventPublisher
    ) {
        this(timeoutResolver, deadlineScheduler, broadcaster, gameCompletionService,
                roundSynchronizationService, registry, roomService, Clock.systemUTC(), eventPublisher);
    }

    RoundTimerService(
            RoundTimeoutResolver timeoutResolver,
            RoundDeadlineScheduler deadlineScheduler,
            RoomBroadcaster broadcaster,
            GameCompletionService gameCompletionService,
            RoundSynchronizationService roundSynchronizationService,
            RoomSessionRegistry registry,
            RoomService roomService,
            Clock clock
    ) {
        this(
                timeoutResolver,
                deadlineScheduler,
                broadcaster,
                gameCompletionService,
                roundSynchronizationService,
                registry,
                roomService,
                clock,
                ignored -> {
                }
        );
    }

    private RoundTimerService(
            RoundTimeoutResolver timeoutResolver,
            RoundDeadlineScheduler deadlineScheduler,
            RoomBroadcaster broadcaster,
            GameCompletionService gameCompletionService,
            RoundSynchronizationService roundSynchronizationService,
            RoomSessionRegistry registry,
            RoomService roomService,
            Clock clock,
            ApplicationEventPublisher eventPublisher
    ) {
        this.timeoutResolver = timeoutResolver;
        this.deadlineScheduler = deadlineScheduler;
        this.broadcaster = broadcaster;
        this.gameCompletionService = gameCompletionService;
        this.roundSynchronizationService = roundSynchronizationService;
        this.registry = registry;
        this.roomService = roomService;
        this.clock = clock;
        this.eventPublisher = eventPublisher;
    }

    /**
     * 이 턴의 마감 타이머를 걸고 방에 round.start를 알린다. 턴 순서를 함께 실어 클라가 추측하지 않게 한다.
     * <p>
     * 턴 주인이 오프라인이면 타이머를 걸지 않고 즉시 진행한다: 첫 오프라인 턴은 점수 없이 스킵,
     * {@value #MAX_OFFLINE_TURNS}번째 턴은 자동 퇴장. 스킵/퇴장 후의 다음 턴은 advanceTurn을
     * 거쳐 다시 여기로 돌아오므로 연속 오프라인 플레이어도 연쇄적으로 처리된다.
     *
     * @return 걸린 마감 시각. 오프라인 스킵/퇴장으로 타이머를 걸지 않았으면 null.
     */
    public Instant start(String roomId, RoundState state) {
        if (isOffline(roomId, state.activePlayerId())) {
            handleOfflineTurn(roomId, state);
            return null;
        }
        // 턴이 시작될 때마다 방 수명을 다시 센다. 이게 없으면 TTL이 "생성 후 40분"이라, 한 판이
        // 그보다 길어지는 순간(6인 × 12라운드면 충분히 가능) 플레이 중인 방이 사라진다.
        roomService.touch(roomId);
        Instant deadline = clock.instant().plus(ROUND_DURATION);
        int roundNumber = state.roundNumber();
        String activePlayerId = state.activePlayerId();
        activeDeadlines.put(roomId, new ActiveDeadline(roundNumber, deadline));
        // 클라에는 마감 시각을 그대로 알리고, 강제 진행만 EXPIRY_GRACE 뒤로 미룬다.
        deadlineScheduler.schedule(
                roomId,
                roundNumber,
                deadline.plus(EXPIRY_GRACE),
                () -> expireTurn(roomId, roundNumber, activePlayerId)
        );
        broadcaster.broadcast(roomId, new WsEnvelope<>(
                type("round.start"),
                clock.millis(),
                new RoundStartPayload(
                        roundNumber,
                        deadline.toEpochMilli(),
                        activePlayerId,
                        state.participantOrder()
                ),
                roomId,
                null
        ));
        eventPublisher.publishEvent(new RoundStartedEvent(roomId, state));
        return deadline;
    }

    public void cancel(String roomId, int roundNumber) {
        deadlineScheduler.cancel(roomId, roundNumber);
        activeDeadlines.computeIfPresent(roomId, (key, active) ->
                active.roundNumber() == roundNumber ? null : active);
    }

    public void cancelRoom(String roomId) {
        deadlineScheduler.cancelRoom(roomId);
        activeDeadlines.remove(roomId);
        offlineMisses.remove(roomId);
    }

    /** 재접속 복귀 시 호출 — 오프라인 결석 횟수를 처음부터 다시 센다. */
    public void clearOfflineMisses(String roomId, String playerId) {
        Map<String, Integer> misses = offlineMisses.get(roomId);
        if (misses != null) misses.remove(playerId);
    }

    /** 재접속 스냅샷이 현재 턴의 서버 마감 시각을 그대로 복원할 때 사용한다. */
    public Optional<Instant> currentDeadline(String roomId) {
        ActiveDeadline active = activeDeadlines.get(roomId);
        return active == null ? Optional.empty() : Optional.of(active.deadline());
    }

    /**
     * 턴이 끝난 뒤의 공통 진행 경로. <b>"다음 턴을 시작할지 게임을 끝낼지"의 판단은 여기 한 곳에만 있다.</b>
     * 제출(WS 핸들러)과 마감 만료(타이머)가 같은 코드를 지나야 두 경로가 갈라지지 않는다.
     *
     * @param requestMsgId 클라이언트 제출이면 그 msgId. 클라는 이 값으로 자기 제출의 확정을 판별한다.
     *                     마감 처리로 들어온 경우엔 점수 방송을 {@link RoundTimeoutResolver}가 이미
     *                     했으므로 score는 null이고 msgId도 없다.
     */
    public void advanceTurn(String roomId, ScoreRoundSubmissionResult result, String requestMsgId) {
        RoundSubmissionResult round = result.round();
        Optional<RoundCompletion> completion = round.completion();
        int endedRoundNumber = completion
                .map(RoundCompletion::roundNumber)
                .orElseGet(() -> round.state().roundNumber());

        // 이전 턴 타이머를 가장 먼저 끊는다. 뒤로 밀면 그 사이 만료가 발화해 턴이 두 번 넘어갈 수 있다.
        cancel(roomId, endedRoundNumber);

        if (result.score() != null) {
            broadcastScoreUpdate(roomId, result.score(), requestMsgId);
        }

        if (completion.isPresent()) {
            broadcaster.broadcast(roomId, roundEnd(roomId, completion.get()));
            // 종료 판정은 저장소(전원 점수판 완료)에 맡기고, 라운드 상한에 닿았으면 강제 종료한다.
            if (gameCompletionService.finishIfComplete(roomId, completion.get().gameCompleted())) {
                return;
            }
        }

        if (round.state().isFinished()) {
            // 라운드 상한에 닿았는데 종료 전이가 실패한 경우(방·게임 정보 유실 등).
            // 타이머를 다시 걸면 끝난 게임이 계속 돌아가므로 여기서 멈춘다.
            log.warn("게임이 라운드 상한에 도달했지만 종료 전이에 실패했습니다: room={}", roomId);
            return;
        }
        start(roomId, round.state());
    }

    private void expireTurn(String roomId, int roundNumber, String activePlayerId) {
        RoundTimeoutResolution resolution =
                timeoutResolver.resolve(roomId, roundNumber, activePlayerId);
        switch (resolution.kind()) {
            // 서버가 대신 굴렸을 뿐 턴 주인은 그대로다. 같은 턴에 남은 굴림을 쓸 시간을 다시 준다.
            case AUTO_ROLLED -> start(roomId, resolution.rolled());
            // 점수 방송은 resolver가 이미 했다. 여기서는 라운드 종료·게임 종료·다음 턴만 판단한다.
            case ADVANCED -> advanceTurn(
                    roomId,
                    new ScoreRoundSubmissionResult(null, resolution.advanced()),
                    null
            );
            case STALE -> {
                // 플레이어가 직접 제출해 이미 턴이 넘어갔다. 그쪽 경로가 타이머를 다시 걸었다.
            }
        }
    }

    /**
     * 게임 중 이탈 확정의 단일 경로 — 명시적 나가기(REST·WS room.leave)와 오프라인
     * {@value #MAX_OFFLINE_TURNS}턴 자동 퇴장이 전부 여기로 모인다.
     * 명단(레지스트리·Redis) 제거 → room.player_left 방송 → 턴 순서 제거 순으로 정리한다.
     * 이미 빠진 플레이어에게는 아무것도 하지 않는다(멱등) — REST 나가기와 소켓 종료가
     * 연달아 도착해도 안전하다.
     */
    public void removePlayer(String roomId, String playerId) {
        clearOfflineMisses(roomId, playerId);
        RoomSessionRegistry.Member removed = registry.removePlayer(roomId, playerId);
        roomService.leave(roomId, playerId);
        if (removed != null) {
            broadcaster.broadcast(roomId, WsEnvelope.of("room.player_left",
                            new RoomPlayerLeftPayload(playerId))
                    .withRoomId(roomId));
            log.info("게임 중 이탈 확정: room={} player={}", roomId, playerId);
        }

        RoundState state = roundSynchronizationService.findByRoomId(roomId).orElse(null);
        if (state == null || state.isFinished() || !state.participantIds().contains(playerId)) {
            return;
        }
        if (state.participantOrder().size() == 1) {
            // 마지막 참가자까지 나갔다 — 이어갈 턴이 없으니 라운드 상태와 타이머를 통째로 버린다.
            cancelRoom(roomId);
            roundSynchronizationService.remove(roomId);
            return;
        }
        if (state.activePlayerId().equals(playerId)) {
            // 진행 중인 자기 턴은 만료 경로로 넘겨 라운드 완료·게임 종료 판정을 한 곳에 유지한다.
            Optional<RoundSubmissionResult> expired =
                    roundSynchronizationService.expire(roomId, state.roundNumber(), playerId);
            RoundState updated = roundSynchronizationService.removeParticipant(roomId, playerId)
                    .orElse(null);
            if (expired.isPresent() && updated != null) {
                advanceTurn(roomId, new ScoreRoundSubmissionResult(null,
                        new RoundSubmissionResult(updated, expired.get().completedRound())), null);
            }
            return;
        }
        roundSynchronizationService.removeParticipant(roomId, playerId);
    }

    /** 명단에 없는 플레이어(비정상 상태)도 오프라인으로 본다 — 연결이 없다는 사실은 같다. */
    private boolean isOffline(String roomId, String playerId) {
        com.ssafy.yorr.room.dto.RoomSnapshot room = roomService.getSnapshot(roomId);
        boolean serverControlled = room != null && room.players().stream()
                .anyMatch(player -> player.playerId().equals(playerId)
                        && player.kind() == ParticipantKind.BOT);
        if (serverControlled) {
            return false;
        }
        RoomSessionRegistry.Member member = registry.find(roomId, playerId);
        return member == null || member.status() == PlayerStatus.OFFLINE;
    }

    private void handleOfflineTurn(String roomId, RoundState state) {
        String playerId = state.activePlayerId();
        int misses = offlineMisses
                .computeIfAbsent(roomId, key -> new ConcurrentHashMap<>())
                .merge(playerId, 1, Integer::sum);
        if (misses >= MAX_OFFLINE_TURNS) {
            log.info("오프라인 {}번째 턴 도래 — 자동 퇴장: room={} player={}", misses, roomId, playerId);
            removePlayer(roomId, playerId);
            return;
        }
        log.info("오프라인 턴 스킵({}/{}): room={} player={}",
                misses, MAX_OFFLINE_TURNS, roomId, playerId);
        roundSynchronizationService.expire(roomId, state.roundNumber(), playerId)
                .ifPresent(result -> advanceTurn(roomId,
                        new ScoreRoundSubmissionResult(null, result), null));
    }

    private void broadcastScoreUpdate(String roomId, ScoreConfirmationResult score, String requestMsgId) {
        broadcaster.broadcast(roomId, WsEnvelope
                .of(type("score.update"), new ScoreUpdatePayload(score.playerId(), score.scoreboard()))
                .withRoomId(roomId)
                .withMsgId(requestMsgId));
    }

    private WsEnvelope<RoundEndPayload> roundEnd(String roomId, RoundCompletion completion) {
        return new WsEnvelope<>(
                type("round.end"),
                clock.millis(),
                new RoundEndPayload(completion.roundNumber(), completion.submittedPlayerIds()),
                roomId,
                null
        );
    }

    private record ActiveDeadline(int roundNumber, Instant deadline) {
    }
}
