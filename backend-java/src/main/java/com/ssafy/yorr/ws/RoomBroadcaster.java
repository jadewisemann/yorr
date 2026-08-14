package com.ssafy.yorr.ws;

import com.ssafy.yorr.ws.dto.WsEnvelope; // ← WsEnvelope 실제 위치에 맞게

/** 방(roomId)에 붙은 모든 세션에 봉투를 브로드캐스트. */
public interface RoomBroadcaster {
    void broadcast(String roomId, WsEnvelope<?> message);
}