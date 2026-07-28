package com.ssafy.yorr.ws;

import com.ssafy.yorr.ws.dto.RoomPhase;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RoomSessionRegistryTest {

    private RoomSessionRegistry registry;
    private int sessionSeq;

    @BeforeEach
    void setUp() {
        registry = new RoomSessionRegistry();
        sessionSeq = 0;
    }

    private WebSocketSession session() {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("session-" + (++sessionSeq));
        return session;
    }

    @Test
    void startsInWaitingPhase() {
        registry.join("ROOM1", session(), "player-1", "호스트");

        assertThat(registry.snapshot("ROOM1").phase()).isEqualTo(RoomPhase.WAITING);
    }

    /**
     * 게임 시작은 REST 가 처리하므로 레지스트리는 markPhase 로만 그 사실을 안다.
     * 여기가 WAITING 으로 고정되면 state.sync 를 방송해도 참가자는 대기실을 벗어나지 못한다.
     */
    @Test
    void reportsPlayingOnceThePhaseIsMarked() {
        registry.join("ROOM1", session(), "player-1", "호스트");
        registry.join("ROOM1", session(), "player-2", "참가자");

        registry.markPhase("ROOM1", RoomPhase.PLAYING);

        assertThat(registry.snapshot("ROOM1").phase()).isEqualTo(RoomPhase.PLAYING);
        assertThat(registry.snapshot("ROOM1").players()).hasSize(2);
    }

    @Test
    void keepsPhasePerRoom() {
        registry.join("ROOM1", session(), "player-1", "호스트");
        registry.join("ROOM2", session(), "player-2", "다른방 호스트");

        registry.markPhase("ROOM1", RoomPhase.PLAYING);

        assertThat(registry.snapshot("ROOM1").phase()).isEqualTo(RoomPhase.PLAYING);
        assertThat(registry.snapshot("ROOM2").phase()).isEqualTo(RoomPhase.WAITING);
    }

    /** 방이 비면 단계도 버려야 한다. 방 코드는 재사용되므로 PLAYING 이 남으면 새 방이 즉시 게임중으로 보인다. */
    @Test
    void forgetsPhaseWhenTheRoomEmpties() {
        WebSocketSession only = session();
        registry.join("ROOM1", only, "player-1", "호스트");
        registry.markPhase("ROOM1", RoomPhase.PLAYING);

        registry.remove(only);
        registry.join("ROOM1", session(), "player-2", "새 호스트");

        assertThat(registry.snapshot("ROOM1").phase()).isEqualTo(RoomPhase.WAITING);
    }
}
