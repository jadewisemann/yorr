package com.ssafy.yorr.room.initializer;

import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.service.RoomCreateService;
import com.ssafy.yorr.room.service.RoomService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * 재시작으로 이어갈 수 없게 된 방만 정리한다.
 * <p>
 * 라운드 상태는 인메모리라({@code InMemoryRoundStateStore}) 프로세스가 재시작되면 사라진다.
 * 그런데 Redis의 방은 남아 있어 phase가 여전히 PLAYING이다. 그 방은 진행할 라운드가 없는데
 * JOIN 스크립트가 {@code game_started}(409)로 참가를 막아, TTL이 끝날 때까지 아무도 들어갈 수
 * 없고 아무 일도 일어나지 않는 상태로 남는다. 그 방만 닫는다.
 * <p>
 * <b>이전 구현은 부팅 때 {@code room:*}를 전부 지웠다.</b> 좀비를 막으려는 의도였지만 배포마다
 * 살아있는 대기실까지 전멸시켜, 플레이 중인 사용자가 방을 잃는 쪽이 훨씬 잦은 피해였다
 * (그리고 {@code KEYS}는 O(N) 블로킹 명령이라 운영 Redis에서 쓸 것이 아니다).
 * 대기실·종료된 방은 라운드 상태 없이도 정상 동작하므로 건드리지 않는다.
 */
@Component
@RequiredArgsConstructor
public class StaleRoomCleaner {

    private static final Logger log = LoggerFactory.getLogger(StaleRoomCleaner.class);

    private final RoomCreateService roomCreateService;
    private final RoomService roomService;

    @EventListener(ApplicationReadyEvent.class)
    public void closeUnrecoverableGamesOnStartup() {
        // 부팅 직후라 메모리에 라운드 상태가 있을 수 없다 = PLAYING이면 곧 복구 불가라는 뜻이다.
        // 트래픽을 받기 전에 도는 시점이라 "방금 시작한 게임"과 헷갈릴 여지도 없다.
        int closed = 0;
        for (String roomCode : roomCreateService.getAllRoomNumbers()) {
            if (roomService.getSnapshot(roomCode).phase() != RoomPhase.PLAYING) {
                continue;
            }
            roomService.close(roomCode);
            closed++;
        }
        if (closed > 0) {
            log.info("재시작으로 이어갈 수 없는 진행 중 방을 닫았습니다: {}개", closed);
        }
    }
}
