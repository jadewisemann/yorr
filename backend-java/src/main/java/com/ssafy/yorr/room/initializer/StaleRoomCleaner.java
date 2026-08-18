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
 * <b>라운드 상태 자체는 재시작을 견딘다</b>({@code RedisYachtDiceStateStore} — Redis에 저장된다).
 * 사라지는 것은 <b>마감 타이머</b>다: {@code InMemoryRoundDeadlineScheduler}의 예약은 프로세스와
 * 함께 증발하고, 부팅 때 그것을 다시 걸어주는 경로가 없다. 그래서 방을 열어두면 상태만 살아 있고
 * 턴은 넘어가지 않는 <b>멈춘 게임</b>이 된다 — 사용자는 방이 사라진 것보다 나쁜, 언제 풀릴지
 * 모르는 화면 앞에 남는다. 반쯤 살아있는 게임을 만들 바에는 정리하는 편이 낫다는 판단이다.
 * <p>
 * 따라서 이 프로젝트는 <b>"새 버전이 올라오면 진행 중이던 게임 세션은 종료된다"</b>를 정책으로
 * 둔다. 방을 닫으면 클라이언트는 {@code ROOM_NOT_FOUND}로 세션을 정리하고 홈으로 돌아간다
 * (재접속 복원 작업에서 만든 경로). 닫지 않으면 JOIN이 {@code game_started}(409)로 참가까지 막아,
 * TTL이 끝날 때까지 아무도 들어갈 수 없는 방으로 남는다.
 * <p>
 * <b>이 컴포넌트는 타이머 복구가 생기면 제거 대상이다.</b> 부팅 시 저장된 마감 시각으로 타이머를
 * 다시 걸 수 있게 되면 정책이 "이어간다"로 뒤집히므로, 그때는 여기를 지우거나 "라운드 상태가 없는
 * PLAYING 방"만 닫도록 좁힌다. 상태를 Redis로 옮기는 일은 이미 끝났으니 다시 시도할 필요는 없다.
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
        // 부팅 직후라 마감 타이머가 하나도 걸려 있지 않다 = PLAYING이면 이어갈 수 없다는 뜻이다.
        // (라운드 상태는 Redis에 남아 있지만 그것만으로는 턴이 진행되지 않는다.)
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
