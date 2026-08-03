package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.match.application.MatchArchiveService;
import com.ssafy.yorr.game.repository.GameCompletionStore;
import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.RealtimeRoomSnapshotService;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.GameOverPayload;
import com.ssafy.yorr.ws.dto.RoomPhase;
import com.ssafy.yorr.ws.dto.StateSyncPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 게임 종료 단일 진입점. 종료 판정·전이·방송이 여기 한 곳에만 있다.
 * <p>
 * 순서가 중요하다: <b>(1) 타이머 정지 → (2) phase 전이(CAS) → (3) 방송</b>.
 * (1)을 먼저 하지 않으면 종료 직후 만료 타이머가 한 번 더 돌아 다음 턴을 시작해버리고,
 * (2)의 CAS가 실패한(=다른 호출이 이미 종료시킨) 경우엔 (3)을 하지 않아 중복 방송이 없다.
 * <p>
 * {@link RoundDeadlineScheduler}를 직접 쓰는 이유는 순환 의존을 피하기 위해서다
 * (RoundTimerService → 이 서비스 방향만 유지한다).
 */
@Service
public class GameCompletionService {

    private static final Logger log = LoggerFactory.getLogger(GameCompletionService.class);

    private final GameCompletionStore completionStore;
    private final MatchArchiveService matchArchiveService;
    private final RoundDeadlineScheduler deadlineScheduler;
    private final RoomService roomService;
    private final RoomSessionRegistry registry;
    private final RealtimeRoomSnapshotService realtimeSnapshots;
    private final RoomBroadcaster broadcaster;

    public GameCompletionService(
            GameCompletionStore completionStore,
            MatchArchiveService matchArchiveService,
            RoundDeadlineScheduler deadlineScheduler,
            RoomService roomService,
            RoomSessionRegistry registry,
            RealtimeRoomSnapshotService realtimeSnapshots,
            RoomBroadcaster broadcaster
    ) {
        this.completionStore = completionStore;
        this.matchArchiveService = matchArchiveService;
        this.deadlineScheduler = deadlineScheduler;
        this.roomService = roomService;
        this.registry = registry;
        this.realtimeSnapshots = realtimeSnapshots;
        this.broadcaster = broadcaster;
    }

    /**
     * 게임이 끝났으면 종료 처리하고 방에 알린다.
     *
     * @param force 라운드 상한에 도달했는지. true면 점수판에 빈 칸이 남아도 종료한다(안전망).
     *              false면 "전원 점수판 12칸 완료"라는 저장소 판정에만 따른다.
     * @return 이 호출이 게임을 종료시켰는지. false면 아직 진행 중이므로 다음 턴을 시작해야 한다.
     */
    public boolean finishIfComplete(String roomId, boolean force) {
        RoomSnapshot room = roomService.getSnapshot(roomId);
        if (room == null || room.gameId() == null || room.gameId().isBlank()) {
            return false;
        }
        // 판정이 성립하기 전에 타이머를 멈추면 진행 중인 게임이 멈춘다 — 반드시 전이가 성공한 뒤에만 정지한다.
        if (!completionStore.finishIfComplete(roomId, room.gameId(), force)) {
            return false;
        }

        deadlineScheduler.cancelRoom(roomId);
        registry.markPhase(roomId, RoomPhase.FINISHED);
        List<GameOverPayload.Ranking> rankings = rankings(roomId);
        archive(room, rankings);
        broadcaster.broadcast(roomId, WsEnvelope.of("game.over", new GameOverPayload(rankings))
                .withRoomId(roomId));
        // phase(finished)는 스냅샷으로만 전달된다 — 이걸 빼면 클라가 결과 화면으로 넘어가지 못한다.
        broadcaster.broadcast(roomId, WsEnvelope.of(
                        "state.sync",
                        new StateSyncPayload(realtimeSnapshots.snapshot(roomId)))
                .withRoomId(roomId));
        log.info("game.over: room={} game={} force={}", roomId, room.gameId(), force);
        return true;
    }

    /**
     * 결과를 DB에 남긴다. <b>실패해도 게임 종료를 막지 않는다</b> — 저장은 나중에 되짚기 위한
     * 것이고, 여기서 예외가 올라가면 눈앞의 사용자가 결과 화면으로 넘어가지 못한다. 그쪽 손해가
     * 훨씬 크다.
     */
    private void archive(RoomSnapshot room, List<GameOverPayload.Ranking> rankings) {
        try {
            matchArchiveService.archive(room, rankings);
        } catch (RuntimeException e) {
            log.error("게임 결과 저장에 실패했습니다(게임 종료는 그대로 진행): game={}", room.gameId(), e);
        }
    }

    /** 동점은 같은 순위를 공유한다(1,2,2,4). 총점은 서버가 확정해 저장한 값만 쓴다. */
    private List<GameOverPayload.Ranking> rankings(String roomId) {
        List<Map.Entry<String, Integer>> ordered = completionStore.readTotals(roomId).entrySet().stream()
                .sorted(Comparator.<Map.Entry<String, Integer>>comparingInt(Map.Entry::getValue).reversed()
                        .thenComparing(Map.Entry::getKey))
                .toList();

        List<GameOverPayload.Ranking> rankings = new java.util.ArrayList<>(ordered.size());
        int rank = 0;
        Integer previousTotal = null;
        for (int index = 0; index < ordered.size(); index++) {
            Map.Entry<String, Integer> entry = ordered.get(index);
            if (previousTotal == null || !previousTotal.equals(entry.getValue())) {
                rank = index + 1;
                previousTotal = entry.getValue();
            }
            rankings.add(new GameOverPayload.Ranking(rank, entry.getKey(), entry.getValue()));
        }
        return rankings;
    }
}
