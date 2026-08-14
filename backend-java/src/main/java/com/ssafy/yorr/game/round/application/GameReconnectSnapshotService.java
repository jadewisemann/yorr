package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.service.GameScoreQueryService;
import com.ssafy.yorr.ws.RealtimeRoomSnapshotService;
import com.ssafy.yorr.game.yacht.YachtDiceState;
import com.ssafy.yorr.ws.dto.RoomPhase;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import org.springframework.stereotype.Service;

/**
 * 재접속 응답용 방·라운드·점수 상태를 한 시점의 전체 스냅샷으로 조립한다.
 */
@Service
public class GameReconnectSnapshotService {

    private final RealtimeRoomSnapshotService realtimeSnapshots;
    private final RoundSynchronizationService roundSynchronizationService;
    private final RoundTimerService roundTimerService;
    private final GameScoreQueryService gameScoreQueryService;

    public GameReconnectSnapshotService(
            RealtimeRoomSnapshotService realtimeSnapshots,
            RoundSynchronizationService roundSynchronizationService,
            RoundTimerService roundTimerService,
            GameScoreQueryService gameScoreQueryService
    ) {
        this.realtimeSnapshots = realtimeSnapshots;
        this.roundSynchronizationService = roundSynchronizationService;
        this.roundTimerService = roundTimerService;
        this.gameScoreQueryService = gameScoreQueryService;
    }

    public RoomSnapshot snapshot(String roomId, String playerId) {
        RoomSnapshot room = realtimeSnapshots.snapshot(roomId);
        if (room.phase() != RoomPhase.PLAYING) {
            return room;
        }

        RoundState round = roundSynchronizationService.findByRoomId(roomId)
                .orElseThrow(() -> new IllegalStateException(
                        "진행 중인 방의 라운드 상태를 찾을 수 없습니다: " + roomId
                ));
        long deadline = roundTimerService.currentDeadline(roomId)
                .orElseThrow(() -> new IllegalStateException(
                        "진행 중인 방의 턴 마감 시각을 찾을 수 없습니다: " + roomId
                ))
                .toEpochMilli();

        YachtDiceState game = new YachtDiceState(
                round.roundNumber(),
                round.activePlayerId(),
                deadline,
                gameScoreQueryService.getScoreboards(roomId, playerId),
                round.participantOrder(),
                // 굴림 진행까지 실어야 재접속한 클라이언트가 이어서 굴릴 수 있다.
                round.activeRollCount(),
                round.activeDice(),
                round.activeHeld()
        );
        return new RoomSnapshot(
                room.roomId(),
                room.gameCode(),
                room.phase(),
                room.hostId(),
                room.players(),
                game,
                room.capacity()
        );
    }
}
