package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.game.round.domain.RoundSynchronizationException;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RoundSynchronizationServiceTest {

    private InMemoryRoundStateStore store;
    private RoundSynchronizationService service;

    @BeforeEach
    void setUp() {
        store = new InMemoryRoundStateStore();
        service = new RoundSynchronizationService(store);
    }

    @Test
    void rejectsSubmissionBeforeRoundInitialization() {
        assertThatThrownBy(() -> service.submit("room-a", "player-a", payload(1)))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.ROUND_NOT_INITIALIZED)
                );
    }

    @Test
    void rejectsInitializingSameRoomTwice() {
        service.initialize("room-a", 1, List.of("player-a"));

        assertThatThrownBy(() -> service.initialize("room-a", 1, List.of("player-a")))
                .isInstanceOfSatisfying(RoundSynchronizationException.class, exception ->
                        assertThat(exception.reason())
                                .isEqualTo(RoundSynchronizationException.Reason.ROUND_ALREADY_INITIALIZED)
                );
    }

    @Test
    void advancesOnlyAfterEachPlayerSubmitsInTurnOrder() {
        int participantCount = 20;
        List<String> participants = new ArrayList<>();
        for (int index = 0; index < participantCount; index++) {
            participants.add("player-" + index);
        }
        service.initialize("room-a", 1, participants);

        List<RoundSubmissionResult> results = new ArrayList<>();
        for (String playerId : participants) {
            results.add(service.submit("room-a", playerId, payload(1)));
        }

        assertThat(results).filteredOn(RoundSubmissionResult::roundCompleted).hasSize(1);
        assertThat(store.findByRoomId("room-a")).hasValueSatisfying(state -> {
            assertThat(state.roundNumber()).isEqualTo(2);
            assertThat(state.submittedPlayerIds()).isEmpty();
            assertThat(state.activePlayerId()).isEqualTo("player-0");
        });
    }

    @Test
    void removalAllowsRoomToBeInitializedAgain() {
        service.initialize("room-a", 1, List.of("player-a"));

        service.remove("room-a");
        service.initialize("room-a", 4, List.of("player-b"));

        assertThat(store.findByRoomId("room-a")).hasValueSatisfying(state ->
                assertThat(state.roundNumber()).isEqualTo(4)
        );
    }

    @Test
    void failedPreCommitActionDoesNotRecordSubmission() {
        service.initialize("room-a", 1, List.of("player-a"));

        assertThatThrownBy(() -> service.submit(
                "room-a",
                "player-a",
                payload(1),
                () -> {
                    throw new IllegalStateException("score store failed");
                }
        )).isInstanceOf(IllegalStateException.class)
                .hasMessage("score store failed");

        assertThat(store.findByRoomId("room-a")).hasValueSatisfying(state -> {
            assertThat(state.roundNumber()).isEqualTo(1);
            assertThat(state.submittedPlayerIds()).isEmpty();
        });
    }

    private static RoundSubmitPayload payload(int roundNumber) {
        return new RoundSubmitPayload(roundNumber, List.of(1, 2, 3, 4, 5), "smallStraight");
    }
}
