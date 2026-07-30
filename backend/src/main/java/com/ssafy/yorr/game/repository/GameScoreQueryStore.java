package com.ssafy.yorr.game.repository;

import com.ssafy.yorr.game.domain.GameScoreSnapshot;

public interface GameScoreQueryStore {

    GameScoreSnapshot findByRoomId(String roomId, String requesterId);
}
