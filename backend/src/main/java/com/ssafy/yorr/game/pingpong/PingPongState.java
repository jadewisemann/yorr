package com.ssafy.yorr.game.pingpong;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record PingPongState(
        int version,
        Phase phase,
        List<String> playerOrder,
        Map<String, Integer> scores,
        Map<String, Long> lastInputSeq,
        Ball ball,
        int rally,
        String serveReceiverId,
        long nextActionAt,
        Event lastEvent
) {
    public PingPongState {
        playerOrder = playerOrder == null ? List.of() : List.copyOf(playerOrder);
        scores = scores == null ? Map.of() : Map.copyOf(scores);
        lastInputSeq = lastInputSeq == null ? Map.of() : Map.copyOf(lastInputSeq);
    }

    public boolean finished() {
        return phase == Phase.FINISHED;
    }

    public enum Phase {
        COUNTDOWN,
        PLAYING,
        FINISHED
    }

    public enum Fault {
        OUT,
        NET
    }

    public enum EventType {
        READY,
        SERVE,
        TOO_EARLY,
        TOO_LATE,
        OK,
        NICE,
        SMASH,
        OUT,
        NET,
        POINT,
        GAME_OVER,
        OPPONENT_LEFT
    }

    public record Ball(
            double pos,
            int direction,
            double speed,
            boolean smash,
            Fault fault,
            double faultFrom,
            double x0,
            double x1,
            long launchedAt
    ) {
    }

    public record Event(long id, EventType type, String playerId, long at) {
    }
}
