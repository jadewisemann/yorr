package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import com.ssafy.yorr.game.round.domain.RoundCompletion;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.RoundEndPayload;
import com.ssafy.yorr.ws.dto.RoundStartPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

@Service
public class RoundTimerService {

    public static final Duration ROUND_DURATION = Duration.ofSeconds(25);
    /**
     * 강제 진행을 마감 시각보다 이만큼 늦춘다.
     * <p>
     * 클라이언트는 마감 시각에 남은 족보 중 최고점을 round.submit으로 자동 기록한다. 서버가 마감
     * 즉시 턴을 넘기면 그 요청이 NOT_ACTIVE_PLAYER로 거절되고, 점수는 본인·상대 어느 점수판에도
     * 남지 않는다(score.update가 아예 발행되지 않음). 왕복 시간과 클라 시계 오차를 흡수할 만큼만 준다.
     */
    static final Duration EXPIRY_GRACE = Duration.ofSeconds(3);

    private final RoundSynchronizationService roundSynchronizationService;
    private final RoundDeadlineScheduler deadlineScheduler;
    private final RoomBroadcaster broadcaster;
    private final Clock clock;

    @Autowired
    public RoundTimerService(
            RoundSynchronizationService roundSynchronizationService,
            RoundDeadlineScheduler deadlineScheduler,
            RoomBroadcaster broadcaster
    ) {
        this(roundSynchronizationService, deadlineScheduler, broadcaster, Clock.systemUTC());
    }

    RoundTimerService(
            RoundSynchronizationService roundSynchronizationService,
            RoundDeadlineScheduler deadlineScheduler,
            RoomBroadcaster broadcaster,
            Clock clock
    ) {
        this.roundSynchronizationService = roundSynchronizationService;
        this.deadlineScheduler = deadlineScheduler;
        this.broadcaster = broadcaster;
        this.clock = clock;
    }

    public Instant start(String roomId, int roundNumber, String activePlayerId) {
        Instant deadline = clock.instant().plus(ROUND_DURATION);
        // 클라에는 마감 시각을 그대로 알리고, 강제 진행만 EXPIRY_GRACE 뒤로 미룬다.
        deadlineScheduler.schedule(
                roomId,
                roundNumber,
                deadline.plus(EXPIRY_GRACE),
                () -> expireAndBroadcast(roomId, roundNumber, activePlayerId)
        );
        broadcaster.broadcast(roomId, new WsEnvelope<>(
                "round.start",
                clock.millis(),
                new RoundStartPayload(roundNumber, deadline.toEpochMilli(), activePlayerId),
                roomId,
                null
        ));
        return deadline;
    }

    public void cancel(String roomId, int roundNumber) {
        deadlineScheduler.cancel(roomId, roundNumber);
    }

    public void cancelRoom(String roomId) {
        deadlineScheduler.cancelRoom(roomId);
    }

    private void expireAndBroadcast(String roomId, int roundNumber, String activePlayerId) {
        roundSynchronizationService.expire(roomId, roundNumber, activePlayerId)
                .ifPresent(result -> advanceAndBroadcast(roomId, result));
    }

    private void advanceAndBroadcast(String roomId, RoundSubmissionResult result) {
        result.completion()
                .ifPresent(completion -> broadcaster.broadcast(roomId, roundEnd(roomId, completion)));
        start(roomId, result.state().roundNumber(), result.state().activePlayerId());
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
}
