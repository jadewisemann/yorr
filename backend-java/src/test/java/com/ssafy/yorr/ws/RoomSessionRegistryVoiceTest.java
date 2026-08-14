package com.ssafy.yorr.ws;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;

import java.util.HashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 음성 채널 명단은 방 명단과 <b>별개</b>다 — 방에는 있는데 마이크만 내려놓은 상태가 정상이다.
 * 그 분리가 실제로 지켜지는지, 그리고 방이 비면 명단이 함께 버려지는지를 본다.
 */
class RoomSessionRegistryVoiceTest {

    private RoomSessionRegistry registry;

    @BeforeEach
    void setUp() {
        registry = new RoomSessionRegistry();
    }

    @Test
    void joinVoiceReturnsTheWholeRosterNotJustTheJoiner() {
        assertThat(registry.joinVoice("room-a", "player-a")).containsExactly("player-a");
        assertThat(registry.joinVoice("room-a", "player-b"))
                .containsExactlyInAnyOrder("player-a", "player-b");
    }

    @Test
    void repeatedJoinIsHarmless() {
        registry.joinVoice("room-a", "player-a");

        // 중복 voice.join(재연결 직후 등)이 명단을 망가뜨리면 안 된다.
        assertThat(registry.joinVoice("room-a", "player-a")).containsExactly("player-a");
    }

    @Test
    void leaveVoiceKeepsThePlayerInTheRoom() {
        WebSocketSession session = session("player-a-session");
        registry.join("room-a", session, "player-a", "Player A");
        registry.joinVoice("room-a", "player-a");

        registry.leaveVoice("room-a", "player-a");

        // 마이크만 내려놓았을 뿐이므로 방 명단에는 그대로 있어야 한다.
        assertThat(registry.voiceMembersOf("room-a")).isEmpty();
        assertThat(registry.find("room-a", "player-a")).isNotNull();
    }

    @Test
    void leavingAPlayerWhoNeverJoinedVoiceIsHarmless() {
        // 소켓 종료 경로는 통화 중이었는지 모른 채 불릴 수 있다.
        assertThat(registry.leaveVoice("room-a", "player-a")).isEmpty();
        assertThat(registry.voiceMembersOf("room-a")).isEmpty();
    }

    @Test
    void voiceRosterIsDroppedWhenTheLastPlayerLeavesTheRoom() {
        WebSocketSession session = session("player-a-session");
        registry.join("room-a", session, "player-a", "Player A");
        registry.joinVoice("room-a", "player-a");

        registry.remove(session);

        // 방 코드가 재사용돼도 이전 통화 명단이 남지 않아야 한다.
        assertThat(registry.voiceMembersOf("room-a")).isEmpty();
    }

    @Test
    void voiceRostersAreIsolatedPerRoom() {
        registry.joinVoice("room-a", "player-a");
        registry.joinVoice("room-b", "player-b");

        assertThat(registry.voiceMembersOf("room-a")).containsExactly("player-a");
        assertThat(registry.voiceMembersOf("room-b")).containsExactly("player-b");
    }

    private static WebSocketSession session(String sessionId) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(sessionId);
        when(session.getAttributes()).thenReturn(new HashMap<>());
        when(session.isOpen()).thenReturn(true);
        return session;
    }
}
