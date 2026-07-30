package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.RoundEndPayload;
import com.ssafy.yorr.ws.dto.RoundStartPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RoundTimerServiceTest {

    private static final Instant NOW = Instant.parse("2026-07-26T00:00:00Z");
    private static final List<String> SOLO = List.of("player-a");
    private static final List<String> DUO = List.of("player-a", "player-b");

    private FakeRoundDeadlineScheduler scheduler;
    private RoomBroadcaster broadcaster;
    private RoundTimeoutResolver timeoutResolver;
    private GameCompletionService gameCompletionService;
    private RoundTimerService timerService;

    @BeforeEach
    void setUp() {
        scheduler = new FakeRoundDeadlineScheduler();
        broadcaster = mock(RoomBroadcaster.class);
        timeoutResolver = mock(RoundTimeoutResolver.class);
        gameCompletionService = mock(GameCompletionService.class);
        timerService = new RoundTimerService(
                timeoutResolver,
                scheduler,
                broadcaster,
                gameCompletionService,
                mock(RoundSynchronizationService.class),
                new RoomSessionRegistry(),
                mock(RoomService.class),
                Clock.fixed(NOW, ZoneOffset.UTC)
        );
    }

    @Test
    void broadcastsRoundStartWithServerDeadlineAndTurnOrder() {
        Instant deadline = timerService.start("room-a", RoundState.start(1, DUO));

        assertThat(deadline).isEqualTo(NOW.plusSeconds(25));
        assertThat(timerService.currentDeadline("room-a")).contains(deadline);
        // 마감 직전에 떠난 round.submit이 도착할 틈을 주고 나서 강제 진행한다.
        assertThat(scheduler.deadline).isEqualTo(deadline.plus(RoundTimerService.EXPIRY_GRACE));
        WsEnvelope<?> message = capturedBroadcast();
        assertThat(message.type()).isEqualTo("round.start");
        assertThat(message.ts()).isEqualTo(NOW.toEpochMilli());
        assertThat(message.roomId()).isEqualTo("room-a");
        assertThat(message.msgId()).isNull();
        // 턴 순서를 함께 실어야 클라가 명단 정렬로 순서를 추측하지 않는다.
        assertThat(message.payload()).isEqualTo(
                new RoundStartPayload(1, deadline.toEpochMilli(), "player-a", DUO)
        );
    }

    @Test
    void givesTheSameTurnFreshTimeAfterAnAutomaticRoll() {
        RoundState rolled = RoundState.start(1, DUO)
                .recordRoll("player-a", 1, 1, noHeld(), List.of(1, 2, 3, 4, 5));
        when(timeoutResolver.resolve("room-a", 1, "player-a"))
                .thenReturn(RoundTimeoutResolution.autoRolled(rolled));
        timerService.start("room-a", RoundState.start(1, DUO));
        reset(broadcaster);

        scheduler.fire();

        // 턴 주인은 그대로다 — 남은 굴림을 직접 쓸 시간을 다시 준다.
        assertThat(capturedBroadcast().payload()).isEqualTo(
                new RoundStartPayload(1, NOW.plusSeconds(25).toEpochMilli(), "player-a", DUO)
        );
        assertThat(scheduler.timeoutAction).isNotNull();
    }

    @Test
    void startsTheNextPlayersTurnWhenTheTimeoutRecordedAScore() {
        RoundState nextTurn = RoundState.start(1, DUO)
                .submit(submission("player-a", 1))
                .state();
        when(timeoutResolver.resolve("room-a", 1, "player-a"))
                .thenReturn(RoundTimeoutResolution.advanced(new RoundSubmissionResult(nextTurn, null)));
        timerService.start("room-a", RoundState.start(1, DUO));
        reset(broadcaster);

        scheduler.fire();

        assertThat(capturedBroadcast().payload()).isEqualTo(
                new RoundStartPayload(1, NOW.plusSeconds(25).toEpochMilli(), "player-b", DUO)
        );
    }

    @Test
    void staleTimeoutBroadcastsNothing() {
        when(timeoutResolver.resolve("room-a", 1, "player-a"))
                .thenReturn(RoundTimeoutResolution.stale());
        timerService.start("room-a", RoundState.start(1, DUO));
        reset(broadcaster);

        scheduler.fire();

        verify(broadcaster, never()).broadcast(anyString(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void announcesRoundEndBeforeTheNextRoundStarts() {
        RoundSubmissionResult completed = RoundState.start(1, SOLO).submit(submission("player-a", 1));
        when(timeoutResolver.resolve("room-a", 1, "player-a"))
                .thenReturn(RoundTimeoutResolution.advanced(completed));
        timerService.start("room-a", RoundState.start(1, SOLO));
        reset(broadcaster);

        scheduler.fire();

        List<WsEnvelope<?>> messages = capturedBroadcasts(2);
        assertThat(messages.get(0).payload()).isEqualTo(new RoundEndPayload(1, SOLO));
        assertThat(messages.get(1).type()).isEqualTo("round.start");
    }

    /** 마감 처리로 들어온 점수는 resolver가 이미 방송했다. 여기서 또 쏘면 클라가 중복 반영한다. */
    @Test
    void doesNotRebroadcastTheScoreRecordedByTheTimeoutPath() {
        RoundSubmissionResult completed = RoundState.start(1, SOLO).submit(submission("player-a", 1));
        when(timeoutResolver.resolve("room-a", 1, "player-a"))
                .thenReturn(RoundTimeoutResolution.advanced(completed));
        timerService.start("room-a", RoundState.start(1, SOLO));
        reset(broadcaster);

        scheduler.fire();

        assertThat(capturedBroadcasts(2))
                .noneMatch(message -> message.type().equals("score.update"));
    }

    @Test
    void broadcastsScoreUpdateThenRoundEndForAPlayerSubmission() {
        RoundSubmissionResult completed = RoundState.start(1, SOLO).submit(submission("player-a", 1));

        timerService.advanceTurn("room-a", new ScoreRoundSubmissionResult(score("player-a"), completed), "msg-1");

        List<WsEnvelope<?>> messages = capturedBroadcasts(3);
        assertThat(messages.get(0).type()).isEqualTo("score.update");
        assertThat(messages.get(0).msgId()).isEqualTo("msg-1");
        assertThat(messages.get(1).type()).isEqualTo("round.end");
        assertThat(messages.get(2).type()).isEqualTo("round.start");
    }

    /**
     * 마지막 라운드가 끝나면 다음 턴 타이머를 걸지 않는다. 이걸 걸면 종료된 게임이 계속 돌아간다
     * (라운드가 무한히 증가하던 원인).
     */
    @Test
    void doesNotStartAnotherTurnWhenTheGameIsOver() {
        RoundSubmissionResult lastRound = RoundState.start(1, SOLO, 2)
                .submit(submission("player-a", 1))
                .state()
                .submit(submission("player-a", 2));
        assertThat(lastRound.completion().orElseThrow().gameCompleted()).isTrue();
        when(gameCompletionService.finishIfComplete("room-a", true)).thenReturn(true);

        timerService.advanceTurn("room-a", new ScoreRoundSubmissionResult(null, lastRound), null);

        assertThat(capturedBroadcasts(1).get(0).type()).isEqualTo("round.end");
        assertThat(scheduler.timeoutAction).isNull();
        assertThat(timerService.currentDeadline("room-a")).isEmpty();
    }

    /** 종료 전이가 실패해도 다음 턴을 걸지 않는다 — 걸면 상한을 넘긴 라운드가 계속 진행된다. */
    @Test
    void stopsWhenTheRoundCapIsReachedEvenIfTheFinishTransitionFails() {
        RoundSubmissionResult lastRound = RoundState.start(1, SOLO, 1).submit(submission("player-a", 1));
        when(gameCompletionService.finishIfComplete(anyString(), anyBoolean())).thenReturn(false);

        timerService.advanceTurn("room-a", new ScoreRoundSubmissionResult(null, lastRound), null);

        assertThat(capturedBroadcasts(1).get(0).type()).isEqualTo("round.end");
        assertThat(scheduler.timeoutAction).isNull();
    }

    private WsEnvelope<?> capturedBroadcast() {
        return capturedBroadcasts(1).get(0);
    }

    private List<WsEnvelope<?>> capturedBroadcasts(int expectedCount) {
        ArgumentCaptor<WsEnvelope<?>> captor = ArgumentCaptor.forClass(WsEnvelope.class);
        verify(broadcaster, org.mockito.Mockito.times(expectedCount))
                .broadcast(org.mockito.ArgumentMatchers.eq("room-a"), captor.capture());
        return captor.getAllValues();
    }

    private static ScoreConfirmationResult score(String playerId) {
        return new ScoreConfirmationResult(
                "game-a",
                playerId,
                1,
                "smallStraight",
                15,
                new ScoreBoard(Map.of("smallStraight", 15), 0, 0, 15)
        );
    }

    private static RoundSubmission submission(String playerId, int roundNumber) {
        return new RoundSubmission(playerId, roundNumber, List.of(1, 2, 3, 4, 5), "smallStraight");
    }

    private static List<Boolean> noHeld() {
        return List.of(false, false, false, false, false);
    }

    private static class FakeRoundDeadlineScheduler implements RoundDeadlineScheduler {

        private Instant deadline;
        private Runnable timeoutAction;

        @Override
        public void schedule(String roomId, int roundNumber, Instant deadline, Runnable timeoutAction) {
            this.deadline = deadline;
            this.timeoutAction = timeoutAction;
        }

        @Override
        public void cancel(String roomId, int roundNumber) {
            timeoutAction = null;
        }

        @Override
        public void cancelRoom(String roomId) {
            timeoutAction = null;
        }

        void fire() {
            Runnable action = timeoutAction;
            timeoutAction = null;
            action.run();
        }
    }
}
