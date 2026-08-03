package com.ssafy.yorr.ws;

import com.ssafy.yorr.room.dto.BotDifficulty;
import com.ssafy.yorr.room.dto.ParticipantKind;
import com.ssafy.yorr.room.dto.RoomPlayerSnapshot;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.dto.PlayerStatus;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RealtimeRoomSnapshotServiceTest {

    @Test
    void mergesPersistentBotsWithHumanConnectionStatus() {
        RoomService rooms = mock(RoomService.class);
        RoomSessionRegistry sessions = new RoomSessionRegistry();
        WebSocketSession hostSession = mock(WebSocketSession.class);
        when(hostSession.getId()).thenReturn("session-host");
        sessions.join("ROOM1", hostSession, "human-1", "사람");

        when(rooms.getSnapshot("ROOM1")).thenReturn(new RoomSnapshot(
                "ROOM1",
                "YACHT_DICE",
                null,
                "human-1",
                com.ssafy.yorr.room.dto.RoomPhase.LOBBY,
                6,
                List.of(
                        new RoomPlayerSnapshot("human-1", "사람", 0),
                        new RoomPlayerSnapshot(
                                "bot-1",
                                "요르봇",
                                0,
                                ParticipantKind.BOT,
                                BotDifficulty.HARD
                        )
                )
        ));

        var snapshot = new RealtimeRoomSnapshotService(rooms, sessions).snapshot("ROOM1");

        assertThat(snapshot.hostId()).isEqualTo("human-1");
        assertThat(snapshot.players()).anySatisfy(player -> {
            assertThat(player.playerId()).isEqualTo("human-1");
            assertThat(player.status()).isEqualTo(PlayerStatus.ONLINE);
            assertThat(player.isHost()).isTrue();
            assertThat(player.kind()).isEqualTo(ParticipantKind.HUMAN);
        });
        assertThat(snapshot.players()).anySatisfy(player -> {
            assertThat(player.playerId()).isEqualTo("bot-1");
            assertThat(player.status()).isEqualTo(PlayerStatus.ONLINE);
            assertThat(player.isHost()).isFalse();
            assertThat(player.kind()).isEqualTo(ParticipantKind.BOT);
            assertThat(player.difficulty()).isEqualTo(BotDifficulty.HARD);
        });
    }

    @Test
    void marksARegisteredHumanWithoutAnActiveSessionOfflineButKeepsBotOnline() {
        RoomService rooms = mock(RoomService.class);
        RoomSessionRegistry sessions = new RoomSessionRegistry();
        when(rooms.getSnapshot("ROOM1")).thenReturn(new RoomSnapshot(
                "ROOM1",
                "YACHT_DICE",
                null,
                "human-1",
                com.ssafy.yorr.room.dto.RoomPhase.PLAYING,
                6,
                List.of(
                        new RoomPlayerSnapshot("human-1", "사람", 0),
                        new RoomPlayerSnapshot(
                                "bot-1",
                                "요르봇",
                                0,
                                ParticipantKind.BOT,
                                BotDifficulty.NORMAL
                        )
                )
        ));

        var snapshot = new RealtimeRoomSnapshotService(rooms, sessions).snapshot("ROOM1");

        assertThat(snapshot.players())
                .filteredOn(player -> player.playerId().equals("human-1"))
                .extracting(player -> player.status())
                .containsExactly(PlayerStatus.OFFLINE);
        assertThat(snapshot.players())
                .filteredOn(player -> player.playerId().equals("bot-1"))
                .extracting(player -> player.status())
                .containsExactly(PlayerStatus.ONLINE);
    }
}
