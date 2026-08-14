package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.room.service.RoomService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 방이 사라졌는데도 남아 있는 라운드 상태를 주기적으로 걷어낸다.
 * <p>
 * <b>왜 필요한가:</b> 라운드 상태는 Redis에 있어 TTL로 스스로 사라지지만, 거기 딸린 인메모리
 * 자원(마감 타이머 예약 · 오프라인 결석 카운트)은 TTL이 청소해주지 않는다. 그것들을 회수하는
 * 경로는 빈 방 유예 타이머 하나뿐인데, 그 예약은 프로세스가 재시작되면 사라진다. 그러면 방이
 * 없어진 뒤에도 남은 상태와 예약을 아무도 치우지 않는다.
 * <p>
 * <b>왜 타이머 대신 스윕인가:</b> 예약이 유실·경합으로 날아가도 다음 주기에 복구되고, Redis의
 * TTL 만료를 자동으로 따라간다(keyspace notification 설정에 의존하지 않는다 — 그쪽은 at-most-once라
 * 이벤트가 유실될 수 있다). 유예 타이머는 "빠른 회수" 최적화로 남고, 정확성은 이 스윕이 받친다.
 */
@Component
public class OrphanedRoundStateSweeper {

    /**
     * 스윕 주기. 이 값이 회수 지연의 상한이다 — 방 TTL(40분)보다 충분히 짧으면 되고,
     * 짧게 잡을 이유도 없다(한 항목이 수 KB 수준이라 몇 분 더 남아도 무해하고, 한 주기마다
     * 상태 키 SCAN이 한 번 돈다).
     */
    static final long SWEEP_INTERVAL_MS = 5 * 60 * 1000L;

    private static final Logger log = LoggerFactory.getLogger(OrphanedRoundStateSweeper.class);

    private final RoundSynchronizationService roundSynchronizationService;
    private final RoundTimerService roundTimerService;
    private final RoomService roomService;

    public OrphanedRoundStateSweeper(
            RoundSynchronizationService roundSynchronizationService,
            RoundTimerService roundTimerService,
            RoomService roomService
    ) {
        this.roundSynchronizationService = roundSynchronizationService;
        this.roundTimerService = roundTimerService;
        this.roomService = roomService;
    }

    /**
     * @return 이번 주기에 걷어낸 방 수. 테스트가 호출 결과를 확인하는 데 쓴다.
     */
    @Scheduled(fixedDelay = SWEEP_INTERVAL_MS, initialDelay = SWEEP_INTERVAL_MS)
    public int sweep() {
        int swept = 0;
        for (String roomId : roundSynchronizationService.roomIds()) {
            if (roomService.getSnapshot(roomId).phase() != null) {
                continue;
            }
            // 순서가 중요하다: 타이머를 먼저 끊어야 방 없는 상태로 만료가 발화하지 않는다.
            roundTimerService.cancelRoom(roomId);
            roundSynchronizationService.remove(roomId);
            swept++;
            log.info("방이 사라진 라운드 상태를 회수했습니다: room={}", roomId);
        }
        return swept;
    }
}
