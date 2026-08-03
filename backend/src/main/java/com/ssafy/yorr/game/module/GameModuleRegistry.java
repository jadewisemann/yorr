package com.ssafy.yorr.game.module;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;
import com.ssafy.yorr.ws.dto.InboundEnvelope;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Component
public class GameModuleRegistry {

    private final Map<String, GameModule> modules;

    public GameModuleRegistry(List<GameModule> modules) {
        Map<String, GameModule> indexed = new HashMap<>();
        for (GameModule module : modules) {
            if (indexed.put(normalize(module.code()), module) != null) {
                throw new IllegalStateException("duplicate_game_code");
            }
        }
        this.modules = Map.copyOf(indexed);
    }

    public GameModule require(String code) {
        GameModule module = modules.get(normalize(code));
        if (module == null) throw new IllegalArgumentException("invalid_game_code");
        return module;
    }

    public String canonicalCode(String code) {
        return require(code).code();
    }

    public boolean dispatch(String gameCode, WebSocketSession session, InboundEnvelope message) throws IOException {
        GameModule module = require(gameCode);
        String prefix = "game." + module.code().toLowerCase(Locale.ROOT) + ".";
        if (message.type() == null || !message.type().startsWith(prefix)) return false;

        String eventType = message.type().substring(prefix.length());
        if (!module.handles(eventType)) return false;
        module.handle(session, new InboundEnvelope(
                eventType, message.ts(), message.payload(), message.roomId(), message.msgId()
        ));
        return true;
    }

    private static String normalize(String code) {
        return code == null ? "" : code.trim().toUpperCase(Locale.ROOT);
    }
}
