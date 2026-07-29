package com.ssafy.yorr.room.service;

import com.ssafy.yorr.room.dto.JoinResult;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.user.UserIdentity;

public interface RoomService {
    JoinResult join(String roomCode, UserIdentity user, String sessionToken);

    boolean leave(String roomCode, String playerId);

    /**
     * 방을 통째로 닫는다. 방·참가자·점수 키와, 게임이 시작됐다면 게임·점수판 키까지 지운다.
     * <p>
     * 마지막 참가자가 REST로 나가면 {@link #leave}가 방 키를 지우지만, 소켓만 끊긴 경우엔
     * 그 경로를 타지 않아 Redis에 빈 방이 남는다. 그때 이 메서드가 정리한다. 이미 없는 방을
     * 닫아도 안전하다(DEL은 없는 키에 무해).
     */
    void close(String roomCode);

    RoomSnapshot getSnapshot(String roomCode);
}
