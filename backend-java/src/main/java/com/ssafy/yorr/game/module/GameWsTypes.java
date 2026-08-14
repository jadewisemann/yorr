package com.ssafy.yorr.game.module;

import java.util.Locale;

/** Builds the public WebSocket type for an event owned by a game module. */
public final class GameWsTypes {

    private GameWsTypes() {
    }

    public static String type(String gameCode, String eventType) {
        if (gameCode == null || gameCode.isBlank() || eventType == null || eventType.isBlank()) {
            throw new IllegalArgumentException("invalid_game_event_type");
        }
        return "game." + gameCode.toLowerCase(Locale.ROOT) + "." + eventType;
    }
}
