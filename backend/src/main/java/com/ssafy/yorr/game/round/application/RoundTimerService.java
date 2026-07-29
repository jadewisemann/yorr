package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import com.ssafy.yorr.game.round.domain.RoundCompletion;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.RoundEndPayload;
import com.ssafy.yorr.ws.dto.RoundStartPayload;
import com.ssafy.yorr.ws.dto.ScoreUpdatePayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

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

    private static final Logger log = LoggerFactory.getLogger(RoundTimerService.class);

    private final RoundTimeoutResolver timeoutResolver;
    private final RoundDeadlineScheduler deadlineScheduler;
    private final RoomBroadcaster broadcaster;
    private final GameCompletionService gameCompletionService;
    private final Clock clock;
    private final Map<String, ActiveDeadline> activeDeadlines = new ConcurrentHashMap<>();

    @Autowired
    public RoundTimerService(
            RoundTimeoutResolver timeoutResolver,
            RoundDeadlineScheduler deadlineScheduler,
            RoomBroadcaster broadcaster,
            GameCompletionService gameCompletionService
    ) {
        this(timeoutResolver, deadlineScheduler, broadcaster, gameCompletionService, Clock.systemUTC());
    }

    RoundTimerService(
            RoundTimeoutResolver timeoutResolver,
            RoundDeadlineScheduler deadlineScheduler,
            RoomBroadcaster broadcaster,
            GameCompletionService gameCompletionService,
            Clock clock
    ) {
        this.timeoutResolver = timeoutResolver;
        this.deadlineScheduler = deadlineScheduler;
        this.broadcaster = broadcaster;
        this.gameCompletionService = gameCompletionService;
        this.clock = clock;
    }

    /** 이 턴의 마감 타이머를 걸고 방에 round.start를 알린다. 턴 순서를 함께 실어 클라가 추측하지 않게 한다. */
    public Instant start(String roomId, RoundState state) {
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
                "round.start",
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

    private void broadcastScoreUpdate(String roomId, ScoreConfirmationResult score, String requestMsgId) {
        broadcaster.broadcast(roomId, WsEnvelope
                .of("score.update", new ScoreUpdatePayload(score.playerId(), score.scoreboard()))
                .withRoomId(roomId)
                .withMsgId(requestMsgId));
    }

    private WsEnvelope<RoundEndPayload> roundEnd(String roomId, RoundCompletion completion) {
        return new WsEnvelope<>(
                "round.end",
                clock.millis(),
                new RoundEndPayload(completion.roundNumber(), completion.submittedPlayerIds()),
                roomId,
                null
        );
    }

    private record ActiveDeadline(int roundNumber, Instant deadline) {
    }
}
