package com.ssafy.yorr.room.dto;

import java.util.List;

public record RoomSnapshot(String roomCode, String gameId, String hostId, RoomPhase phase, int capacity,
                           List<RoomPlayerSnapshot> players) {
    public static RoomSnapshot notFound(String roomCode) {
        return new RoomSnapshot(roomCode, null, null, null, 0, List.of());
    }
}
