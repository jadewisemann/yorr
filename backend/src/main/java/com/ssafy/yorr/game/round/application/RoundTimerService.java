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
        deadlineScheduler.schedule(
                roomId,
                roundNumber,
                deadline,
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
