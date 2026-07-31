package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.application.port.RoundStateStore;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.game.round.domain.RoundCompletion;
import com.ssafy.yorr.game.round.domain.RoundSynchronizationException;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.DiceHoldPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.IntSupplier;

@Service
public class RoundSynchronizationService {

    private final RoundStateStore roundStateStore;
    private final IntSupplier dieRoller;

    @Autowired
    public RoundSynchronizationService(RoundStateStore roundStateStore) {
        this(roundStateStore, () -> ThreadLocalRandom.current().nextInt(1, 7));
    }

    RoundSynchronizationService(RoundStateStore roundStateStore, IntSupplier dieRoller) {
        this.roundStateStore = roundStateStore;
        this.dieRoller = dieRoller;
    }

    public RoundState initialize(String roomId, int roundNumber, Collection<String> participantIds) {
        RoundState initialState = RoundState.start(roundNumber, participantIds);
        roundStateStore.initialize(roomId, initialState);
        return initialState;
    }

    public RoundSubmissionResult submit(String roomId, String playerId, RoundSubmitPayload payload) {
        return submit(roomId, playerId, payload, () -> {});
    }

    public RoundSubmissionResult submit(
            String roomId,
            String playerId,
            RoundSubmitPayload payload,
            Runnable beforeStateChange
    ) {
        if (payload == null) {
            throw new IllegalArgumentException("payload must not be null");
        }
        if (beforeStateChange == null) {
            throw new IllegalArgumentException("beforeStateChange must not be null");
        }
        RoundSubmission submission = new RoundSubmission(
                playerId,
                payload.roundNumber(),
                payload.dice(),
                payload.category()
        );
        return roundStateStore.submitAtomically(roomId, submission, beforeStateChange);
    }

    public Optional<RoundSubmissionResult> expire(
            String roomId,
            int expectedRoundNumber,
            String expectedActivePlayerId
    ) {
        return roundStateStore.expireAtomically(roomId, expectedRoundNumber, expectedActivePlayerId);
    }

    /**
     * 마감 시각이 지난 턴을 대신해 한 번 굴린다. 굴림이 남지 않았거나 그 사이 턴이 넘어갔으면
     * 비어 있는 값을 돌려준다 — 호출자는 그때 점수 기록으로 넘어간다.
     */
    public Optional<RoundState> autoRoll(String roomId, int roundNumber, String activePlayerId) {
        return roundStateStore.autoRollAtomically(roomId, roundNumber, activePlayerId, rollDice());
    }

    public Optional<RoundState> findByRoomId(String roomId) {
        return roundStateStore.findByRoomId(roomId);
    }

    /** 라운드 상태를 들고 있는 모든 방. 고아 상태를 걷어내는 스윕이 쓴다. */
    public java.util.Set<String> roomIds() {
        return roundStateStore.roomIds();
    }

    public RoundState recordRoll(String roomId, String playerId, DiceRollPayload payload) {
        if (payload == null) {
            throw new IllegalArgumentException("payload must not be null");
        }
        List<Integer> rolledDice = rollDice();
        return roundStateStore.recordRollAtomically(
                roomId,
                playerId,
                payload.roundNumber(),
                payload.rollCount(),
                payload.held(),
                rolledDice
        );
    }

    /** 굴림 사이에 바꾼 KEEP을 서버 상태에 반영한다. 관전자 방송과 마감 자동 굴림이 이 값을 쓴다. */
    public RoundState recordHold(String roomId, String playerId, DiceHoldPayload payload) {
        if (payload == null) {
            throw new IllegalArgumentException("payload must not be null");
        }
        return roundStateStore.recordHoldAtomically(
                roomId,
                playerId,
                payload.roundNumber(),
                payload.held()
        );
    }

    /**
     * 게임 중 이탈한 참가자를 턴 순서에서 뺀다. 활성 플레이어는 먼저
     * {@link #expire}로 턴을 넘긴 뒤에만 뺄 수 있다({@link RoundState#withoutParticipant}).
     */
    public Optional<RoundState> removeParticipant(String roomId, String playerId) {
        return roundStateStore.removeParticipantAtomically(roomId, playerId);
    }

    public boolean remove(String roomId) {
        return roundStateStore.remove(roomId);
    }

    private List<Integer> rollDice() {
        return java.util.stream.IntStream.range(0, 5)
                .map(ignored -> dieRoller.getAsInt())
                .boxed()
                .toList();
    }
}
