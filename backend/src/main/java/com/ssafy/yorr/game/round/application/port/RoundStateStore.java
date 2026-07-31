package com.ssafy.yorr.game.round.application.port;

import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;

import java.util.Optional;
import java.util.Set;

public interface RoundStateStore {

    void initialize(String roomId, RoundState initialState);

    /**
     * Applies one submission and stores the returned state as one atomic operation.
     * Implementations must prevent two concurrent final submissions from completing
     * the same round more than once. The callback runs after submission validation
     * and before the state change is committed. If it fails, the current round state
     * must remain unchanged.
     */
    RoundSubmissionResult submitAtomically(
            String roomId,
            RoundSubmission submission,
            Runnable beforeStateChange
    );

    RoundState recordRollAtomically(
            String roomId,
            String playerId,
            int roundNumber,
            int rollCount,
            java.util.List<Boolean> held,
            java.util.List<Integer> rolledDice
    );

    /** Stores the KEEP the active player changed between rolls. */
    RoundState recordHoldAtomically(
            String roomId,
            String playerId,
            int roundNumber,
            java.util.List<Boolean> held
    );

    /**
     * Rolls once on behalf of the active player, but only while the expected turn is
     * still current and it still has rolls left. Returns empty when the turn already
     * moved on or the roll budget is spent — the caller then records a score instead.
     */
    Optional<RoundState> autoRollAtomically(
            String roomId,
            int expectedRoundNumber,
            String expectedActivePlayerId,
            java.util.List<Integer> rolledDice
    );

    /**
     * Completes the round only when it is still the expected current round.
     * Returns empty when the room was removed or another path already advanced it.
     */
    Optional<RoundSubmissionResult> expireAtomically(
            String roomId,
            int expectedRoundNumber,
            String expectedActivePlayerId
    );

    /**
     * Removes a departed participant from the turn order without advancing the turn.
     * The active player must be advanced past first (see expireAtomically). Returns
     * the updated state, or empty when the room has no round state.
     */
    Optional<RoundState> removeParticipantAtomically(String roomId, String playerId);

    Optional<RoundState> findByRoomId(String roomId);

    /**
     * 라운드 상태를 들고 있는 모든 방. 방이 사라졌는데도 남은 항목을 주기적으로 걷어내는
     * 스윕이 이 목록을 쓴다 — 이게 없으면 회수 경로가 유예 타이머 하나뿐이고, 그 타이머는
     * 프로세스 재시작에 사라져 아무도 치우지 않는 상태가 된다.
     */
    Set<String> roomIds();

    boolean remove(String roomId);
}
