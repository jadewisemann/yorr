package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OrphanedRoundStateSweeperTest {

    private final InMemoryRoundStateStore store = new InMemoryRoundStateStore();
    private final RoundSynchronizationService roundService = new RoundSynchronizationService(store);
    private final RoundTimerService timerService = mock(RoundTimerService.class);
    private final RoomService roomService = mock(RoomService.class);
    private final OrphanedRoundStateSweeper sweeper =
            new OrphanedRoundStateSweeper(roundService, timerService, roomService);

    /**
     * Redis TTL은 서버 메모리를 청소해주지 않는다. 방이 만료로 사라지면 라운드 상태를 회수할
     * 경로가 유예 타이머뿐인데 그 예약은 재시작에 사라진다 — 그래서 스윕이 받쳐야 한다.
     */
    @Test
    void sweepsRoundStateWhoseRoomIsGone() {
        store.initialize("gone-room", RoundState.start(1, List.of("player-a")));
        when(roomService.getSnapshot("gone-room")).thenReturn(RoomSnapshot.notFound("gone-room"));

        assertThat(sweeper.sweep()).isEqualTo(1);

        assertThat(store.findByRoomId("gone-room")).isEmpty();
        // 타이머를 먼저 끊어야 방 없는 상태로 만료가 발화하지 않는다.
        verify(timerService).cancelRoom("gone-room");
    }

    @Test
    void keepsRoundStateOfALiveRoom() {
        store.initialize("live-room", RoundState.start(1, List.of("player-a")));
        when(roomService.getSnapshot("live-room")).thenReturn(
                new RoomSnapshot("live-room", "game-a", "player-a", RoomPhase.PLAYING, 6, List.of())
        );

        assertThat(sweeper.sweep()).isZero();

        assertThat(store.findByRoomId("live-room")).isPresent();
        verify(timerService, never()).cancelRoom("live-room");
    }

    /** 순회 중 remove를 호출하므로 살아있는 keySet을 쓰면 터진다. 여러 방이 섞여도 안전해야 한다. */
    @Test
    void sweepsOnlyTheGoneRoomsWhenBothKindsExist() {
        store.initialize("gone-room", RoundState.start(1, List.of("player-a")));
        store.initialize("live-room", RoundState.start(1, List.of("player-b")));
        when(roomService.getSnapshot("gone-room")).thenReturn(RoomSnapshot.notFound("gone-room"));
        when(roomService.getSnapshot("live-room")).thenReturn(
                new RoomSnapshot("live-room", "game-a", "player-b", RoomPhase.PLAYING, 6, List.of())
        );

        assertThat(sweeper.sweep()).isEqualTo(1);

        assertThat(store.findByRoomId("gone-room")).isEmpty();
        assertThat(store.findByRoomId("live-room")).isPresent();
    }
}
