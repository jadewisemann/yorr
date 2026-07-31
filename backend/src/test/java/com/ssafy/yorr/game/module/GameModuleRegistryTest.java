package com.ssafy.yorr.game.module;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
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
}
