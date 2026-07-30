package com.ssafy.yorr.room.dto;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RoomSnapshotTest {

    @Test
    void missingRoomHasNoPhaseOrPlayers() {
        RoomSnapshot snapshot = RoomSnapshot.notFound("missing");
        assertNull(snapshot.phase());
        assertTrue(snapshot.players().isEmpty());
    }
}
