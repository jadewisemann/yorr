package com.ssafy.yorr.room.service;

import com.ssafy.yorr.room.dto.JoinResult;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.user.UserIdentity;

public interface RoomService {
    JoinResult join(String roomCode, UserIdentity user, String sessionToken);

    boolean leave(String roomCode, String playerId);

    RoomSnapshot getSnapshot(String roomCode);
}
