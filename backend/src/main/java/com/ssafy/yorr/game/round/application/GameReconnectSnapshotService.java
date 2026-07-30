package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.service.GameScoreQueryService;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.GameState;
import com.ssafy.yorr.ws.dto.RoomPhase;
import com.ssafy.yorr.ws.dto.RoomSnapshot;
import org.springframework.stereotype.Service;

/**
 * 재접속 응답용 방·라운드·점수 상태를 한 시점의 전체 스냅샷으로 조립한다.
 */
@Service
public class GameReconnectSnapshotService {

    private final RoomSessionRegistry registry;
    private final RoundSynchronizationService roundSynchronizationService;
    private final RoundTimerService roundTimerService;
    private final GameScoreQueryService gameScoreQueryService;

    public GameReconnectSnapshotService(
            RoomSessionRegistry registry,
            RoundSynchronizationService roundSynchronizationService,
            RoundTimerService roundTimerService,
            GameScoreQueryService gameScoreQueryService
    ) {
        this.registry = registry;
        this.roundSynchronizationService = roundSynchronizationService;
        this.roundTimerService = roundTimerService;
        this.gameScoreQueryService = gameScoreQueryService;
    }

    public RoomSnapshot snapshot(String roomId, String playerId) {
        RoomSnapshot room = registry.snapshot(roomId);
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

        GameState game = new GameState(
                round.roundNumber(),
                round.activePlayerId(),
                deadline,
                gameScoreQueryService.getScoreboards(roomId, playerId),
                round.participantOrder()
        );
        return new RoomSnapshot(
                room.roomId(),
                room.phase(),
                room.hostId(),
                room.players(),
                game
        );
    }
}
