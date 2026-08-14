package com.ssafy.yorr.room.dto;

import java.util.List;

public record RoomSnapshot(String roomCode, String gameCode, String gameId, String hostId, RoomPhase phase, int capacity,
                           List<RoomPlayerSnapshot> players) {
    public RoomSnapshot(String roomCode, String gameId, String hostId, RoomPhase phase, int capacity,
                        List<RoomPlayerSnapshot> players) {
        this(roomCode, null, gameId, hostId, phase, capacity, players);
    }

    public static RoomSnapshot notFound(String roomCode) {
        return new RoomSnapshot(roomCode, null, null, null, null, 0, List.of());
    }
}
