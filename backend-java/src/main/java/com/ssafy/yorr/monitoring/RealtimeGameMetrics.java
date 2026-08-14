package com.ssafy.yorr.monitoring;

import com.ssafy.yorr.game.module.GameModuleRegistry;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;
import org.springframework.stereotype.Component;

@Component
public class RealtimeGameMetrics implements MeterBinder {

    private final RoomSessionRegistry roomSessionRegistry;
    private final GameModuleRegistry gameModuleRegistry;

    public RealtimeGameMetrics(
            RoomSessionRegistry roomSessionRegistry,
            GameModuleRegistry gameModuleRegistry
    ) {
        this.roomSessionRegistry = roomSessionRegistry;
        this.gameModuleRegistry = gameModuleRegistry;
    }

    @Override
    public void bindTo(MeterRegistry registry) {
        Gauge.builder(
                        "yorr.rooms.active",
                        roomSessionRegistry,
                        RoomSessionRegistry::activeRoomCount
                )
                .description("현재 게임을 진행 중인 전체 방 수")
                .register(registry);

        for (String gameCode : gameModuleRegistry.supportedCodes()) {
            Gauge.builder(
                            "yorr.game.participants.active",
                            roomSessionRegistry,
                            roomRegistry -> roomRegistry.activeParticipantCount(gameCode)
                    )
                    .description("게임별 현재 WebSocket 연결 참가자 수")
                    .tag("game", gameCode)
                    .register(registry);
        }
    }
}
