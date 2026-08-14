package com.ssafy.yorr.room.port;

import java.time.Duration;

/**
 * "방이 비었으니 잠시 뒤 닫는다"를 예약한다. 방 하나당 예약은 하나뿐이며 다시 예약하면 교체된다.
 * <p>
 * 즉시 닫지 않는 이유: 새로고침은 소켓을 끊고 다시 연결하는 동작이라, 마지막 참가자가
 * 새로고침하는 순간 방이 비어 보인다. 그때 바로 닫으면 본인이 자기 방을 파괴한다.
 */
public interface RoomCloseScheduler {

    void schedule(String roomId, Duration delay, Runnable closeTask);

    /**
     * 예약을 취소한다. 누군가 돌아와 방이 다시 살아났을 때 호출한다.
     *
     * @return 실제로 취소할 예약이 있었으면 true. 호출자는 이 값으로 "복귀"를 판별한다.
     */
    boolean cancel(String roomId);
}
