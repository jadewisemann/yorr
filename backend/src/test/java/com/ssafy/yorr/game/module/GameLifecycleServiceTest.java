package com.ssafy.yorr.game.module;

import com.ssafy.yorr.room.dto.GameStartResponse;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomPlayerSnapshot;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomValidationService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GameLifecycleServiceTest {

    @Test
    void rollsBackOnlyTheWinningGameWhenModuleInitializationFails() {
        RoomValidationService rooms = mock(RoomValidationService.class);
        GameModuleRegistry modules = mock(GameModuleRegistry.class);
        GameModule module = mock(GameModule.class);
        GameStartResponse game = new GameStartResponse("game-1", new RoomSnapshot(
                "ROOM01",
                "YACHT_DICE",
                "game-1",
                "host-1",
                RoomPhase.PLAYING,
                6,
                List.of(new RoomPlayerSnapshot("host-1", "host", 0))
        ));
        when(rooms.getSnapshot("ROOM01")).thenReturn(game.snapshot());
        when(rooms.startGame("ROOM01", 1)).thenReturn(game);
        when(modules.require("YACHT_DICE")).thenReturn(module);
        when(module.minPlayers()).thenReturn(1);
        RuntimeException failure = new IllegalStateException("initialization_failed");
        org.mockito.Mockito.doThrow(failure).when(module).start("ROOM01", game);

        assertThatThrownBy(() -> new GameLifecycleService(rooms, modules).start("ROOM01"))
                .isSameAs(failure);
        verify(rooms).rollbackStart("ROOM01", "game-1");
    }
}
