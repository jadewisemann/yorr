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
     * 마감 처리 자체는 서버가 한다({@link RoundTimeoutResolver}). 다만 플레이어가 마감 직전에
     * 누른 round.submit이 아직 날아오는 중일 수 있고, 그 요청이 NOT_YOUR_TURN으로 거절되면
     * 본인이 고른 족보 대신 서버가 고른 족보가 기록된다. 왕복 시간과 클라 시계 오차를 흡수할
     * 만큼만 준다.
     */
    static final Duration EXPIRY_GRACE = Duration.ofSeconds(1);

    private final RoundTimeoutResolver timeoutResolver;
    private final RoundDeadlineScheduler deadlineScheduler;
    private final RoomBroadcaster broadcaster;
    private final Clock clock;

    @Autowired
    public RoundTimerService(
            RoundTimeoutResolver timeoutResolver,
            RoundDeadlineScheduler deadlineScheduler,
            RoomBroadcaster broadcaster
    ) {
        this(timeoutResolver, deadlineScheduler, broadcaster, Clock.systemUTC());
    }

    RoundTimerService(
            RoundTimeoutResolver timeoutResolver,
            RoundDeadlineScheduler deadlineScheduler,
            RoomBroadcaster broadcaster,
            Clock clock
    ) {
        this.timeoutResolver = timeoutResolver;
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
        RoundTimeoutResolution resolution =
                timeoutResolver.resolve(roomId, roundNumber, activePlayerId);
        switch (resolution.kind()) {
            // 서버가 대신 굴렸을 뿐 턴 주인은 그대로다. 같은 턴에 남은 굴림을 쓸 시간을 다시 준다.
            case AUTO_ROLLED -> start(roomId, roundNumber, activePlayerId);
            case ADVANCED -> advanceAndBroadcast(roomId, resolution.advanced());
            case STALE -> {
                // 플레이어가 직접 제출해 이미 턴이 넘어갔다. 그쪽 경로가 타이머를 다시 걸었다.
            }
        }
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
