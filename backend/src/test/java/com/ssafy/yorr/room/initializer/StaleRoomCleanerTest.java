package com.ssafy.yorr.room.initializer;

import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomCreateService;
import com.ssafy.yorr.room.service.RoomService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class StaleRoomCleanerTest {

    private final RoomCreateService roomCreateService = mock(RoomCreateService.class);
    private final RoomService roomService = mock(RoomService.class);
    private final StaleRoomCleaner cleaner = new StaleRoomCleaner(roomCreateService, roomService);

    /**
     * 이전 구현은 부팅 때 모든 방을 지워, 배포마다 살아있는 대기실까지 전멸시켰다.
     * 라운드 상태 없이도 정상 동작하는 방은 건드리지 않아야 한다.
     */
    @Test
    void keepsLobbyAndFinishedRoomsOnStartup() {
        when(roomCreateService.getAllRoomNumbers()).thenReturn(Set.of("lobby-room", "finished-room"));
        when(roomService.getSnapshot("lobby-room")).thenReturn(snapshot("lobby-room", RoomPhase.LOBBY));
        when(roomService.getSnapshot("finished-room"))
                .thenReturn(snapshot("finished-room", RoomPhase.FINISHED));

        cleaner.closeUnrecoverableGamesOnStartup();

        verify(roomService, never()).close("lobby-room");
        verify(roomService, never()).close("finished-room");
    }

    /**
     * 라운드 상태는 인메모리라 재시작으로 사라진다. Redis만 PLAYING으로 남은 방은 진행할 턴이
     * 없는데 JOIN이 game_started로 참가를 막아, TTL이 끝날 때까지 아무도 못 들어가는 방이 된다.
     */
    @Test
    void closesPlayingRoomsThatCanNoLongerContinue() {
        when(roomCreateService.getAllRoomNumbers()).thenReturn(Set.of("playing-room", "lobby-room"));
        when(roomService.getSnapshot("playing-room"))
                .thenReturn(snapshot("playing-room", RoomPhase.PLAYING));
        when(roomService.getSnapshot("lobby-room")).thenReturn(snapshot("lobby-room", RoomPhase.LOBBY));

        cleaner.closeUnrecoverableGamesOnStartup();

        verify(roomService).close("playing-room");
        verify(roomService, never()).close("lobby-room");
    }

    /** 이미 만료돼 phase를 못 읽는 방은 닫을 것도 없다 — close를 부르지 않는다. */
    @Test
    void ignoresRoomsThatAreAlreadyGone() {
        when(roomCreateService.getAllRoomNumbers()).thenReturn(Set.of("gone-room"));
        when(roomService.getSnapshot("gone-room")).thenReturn(RoomSnapshot.notFound("gone-room"));

        cleaner.closeUnrecoverableGamesOnStartup();

        verify(roomService, never()).close("gone-room");
    }

    private static RoomSnapshot snapshot(String roomCode, RoomPhase phase) {
        return new RoomSnapshot(roomCode, null, "host", phase, 6, List.of());
    }
}
