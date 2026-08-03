package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.application.RoundTimerService;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionResult;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionService;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.DiceBroadcastPayload;
import com.ssafy.yorr.ws.dto.DiceHoldChangedPayload;
import com.ssafy.yorr.ws.dto.DiceHoldPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.springframework.stereotype.Service;

import static com.ssafy.yorr.game.yacht.YachtDiceWsTypes.type;

/**
 * 사람의 WebSocket 요청과 서버가 제어하는 봇이 공유하는 요트 다이스 행동 경계.
 *
 * <p>호출자는 행동 주체와 요청 값을 전달할 뿐이며, 상태 변경 이후 필요한 방송과
 * 타이머 진행은 이 서비스가 동일하게 처리한다.</p>
 */
@Service
public class YachtTurnActionService {

    private final RoundSynchronizationService rounds;
    private final RoundTimerService timers;
    private final RoomBroadcaster broadcaster;
    private final ScoreRoundSubmissionService submissions;

    public YachtTurnActionService(
            RoundSynchronizationService rounds,
            RoundTimerService timers,
            RoomBroadcaster broadcaster,
            ScoreRoundSubmissionService submissions
    ) {
        this.rounds = rounds;
        this.timers = timers;
        this.broadcaster = broadcaster;
        this.submissions = submissions;
    }

    public RoundState roll(
            String roomId,
            String actorId,
            DiceRollPayload payload,
            String requestMsgId
    ) {
        RoundState state = rounds.recordRoll(roomId, actorId, payload);
        broadcaster.broadcast(roomId, WsEnvelope.of(type("dice.broadcast"), new DiceBroadcastPayload(
                actorId,
                state.roundNumber(),
                state.activeRollCount(),
                state.activeDice(),
                payload.held(),
                false
        )).withRoomId(roomId).withMsgId(requestMsgId));
        timers.start(roomId, state);
        return state;
    }

    public RoundState hold(
            String roomId,
            String actorId,
            DiceHoldPayload payload,
            String requestMsgId
    ) {
        RoundState state = rounds.recordHold(roomId, actorId, payload);
        broadcaster.broadcast(roomId, WsEnvelope.of(
                type("dice.hold_changed"),
                new DiceHoldChangedPayload(actorId, state.roundNumber(), state.activeHeld())
        ).withRoomId(roomId).withMsgId(requestMsgId));
        return state;
    }

    public ScoreRoundSubmissionResult submitScore(
            String roomId,
            String actorId,
            RoundSubmitPayload payload,
            String requestMsgId
    ) {
        ScoreRoundSubmissionResult result = submissions.submit(roomId, actorId, payload);
        timers.advanceTurn(roomId, result, requestMsgId);
        return result;
    }
}
