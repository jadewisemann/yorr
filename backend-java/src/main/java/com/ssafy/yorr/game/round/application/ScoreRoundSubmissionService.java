package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.dto.ScoreConfirmationCommand;
import com.ssafy.yorr.game.dto.ScoreConfirmationResult;
import com.ssafy.yorr.game.exception.ScoreConfirmationException;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import org.springframework.stereotype.Service;

import java.util.concurrent.atomic.AtomicReference;

import static com.ssafy.yorr.game.exception.ScoreConfirmationException.Reason.GAME_NOT_FOUND;

@Service
public class ScoreRoundSubmissionService {

    private final RoundSynchronizationService roundSynchronizationService;
    private final ScoreConfirmationService scoreConfirmationService;
    private final RoomService roomService;

    public ScoreRoundSubmissionService(
            RoundSynchronizationService roundSynchronizationService,
            ScoreConfirmationService scoreConfirmationService,
            RoomService roomService
    ) {
        this.roundSynchronizationService = roundSynchronizationService;
        this.scoreConfirmationService = scoreConfirmationService;
        this.roomService = roomService;
    }

    public ScoreRoundSubmissionResult submit(
            String roomId,
            String playerId,
            RoundSubmitPayload payload
    ) {
        AtomicReference<ScoreConfirmationResult> scoreHolder = new AtomicReference<>();
        RoundSubmissionResult roundResult = roundSynchronizationService.submit(
                roomId,
                playerId,
                payload,
                () -> scoreHolder.set(confirmScore(roomId, playerId, payload))
        );
        return new ScoreRoundSubmissionResult(scoreHolder.get(), roundResult);
    }

    private ScoreConfirmationResult confirmScore(
            String roomId,
            String playerId,
            RoundSubmitPayload payload
    ) {
        RoomSnapshot room = roomService.getSnapshot(roomId);
        if (room == null || room.gameId() == null || room.gameId().isBlank()) {
            throw new ScoreConfirmationException(
                    GAME_NOT_FOUND,
                    "진행 중인 게임을 찾을 수 없습니다: " + roomId
            );
        }
        return scoreConfirmationService.confirm(new ScoreConfirmationCommand(
                room.gameId(),
                playerId,
                payload.roundNumber(),
                payload.category(),
                payload.dice()
        ));
    }
}
