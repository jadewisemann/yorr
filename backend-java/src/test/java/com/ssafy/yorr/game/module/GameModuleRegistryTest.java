package com.ssafy.yorr.game.module;

import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;
import com.ssafy.yorr.ws.dto.InboundEnvelope;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GameModuleRegistryTest {

    @Test
    void resolvesCanonicalGameCode() {
        GameModule yacht = mock(GameModule.class);
        when(yacht.code()).thenReturn("YACHT_DICE");
        GameModuleRegistry registry = new GameModuleRegistry(List.of(yacht));

        assertThat(registry.canonicalCode(" yacht_dice ")).isEqualTo("YACHT_DICE");
        assertThatThrownBy(() -> registry.require("unknown"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("invalid_game_code");
    }

    @Test
    void dispatchesOnlyMatchingGameNamespace() throws Exception {
        GameModule yacht = mock(GameModule.class);
        WebSocketSession session = mock(WebSocketSession.class);
        when(yacht.code()).thenReturn("YACHT_DICE");
        when(yacht.handles("dice.roll")).thenReturn(true);
        GameModuleRegistry registry = new GameModuleRegistry(List.of(yacht));

        InboundEnvelope namespaced = new InboundEnvelope(
                "game.yacht_dice.dice.roll", 1L, null, "ROOM", "msg-1"
        );

        assertThat(registry.dispatch("YACHT_DICE", session, namespaced)).isTrue();
        verify(yacht).handle(session, new InboundEnvelope("dice.roll", 1L, null, "ROOM", "msg-1"));
        assertThat(registry.dispatch("YACHT_DICE", session,
                new InboundEnvelope("dice.roll", 1L, null, "ROOM", "msg-2"))).isFalse();
        assertThat(registry.dispatch("YACHT_DICE", session,
                new InboundEnvelope("game.omok.dice.roll", 1L, null, "ROOM", "msg-3"))).isFalse();
    }
}
