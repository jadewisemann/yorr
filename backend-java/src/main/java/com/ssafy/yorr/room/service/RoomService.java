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

    /**
     * 활동이 있었음을 알려 방 키의 수명을 처음부터 다시 센다(sliding TTL). 방·참가자·점수 키와
     * 게임이 시작됐다면 게임·점수판 키까지 같은 시각에 만료되도록 함께 늘린다.
     * <p>
     * 이게 없으면 TTL이 "생성 후 N분"이라, 활발히 플레이 중인 방도 정해진 시각에 사라진다.
     * 그러면 남은 사람은 계속 노는데 신규 참가만 404가 나고, 메모리에만 존재하는 방이 된다.
     * 이미 없는 방을 touch해도 안전하다(아무것도 하지 않는다).
     */
    void touch(String roomCode);

    RoomSnapshot getSnapshot(String roomCode);
}
