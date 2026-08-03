package com.ssafy.yorr.room.dto;

/**
 * 방의 진행 방식.
 * <p>
 * {@code NORMAL} — 방을 만든 사람도 플레이어다(기존 동작).
 * <p>
 * {@code PARTY} — 방을 만든 화면은 <b>대시보드</b>다. 게임을 비추고 호스트 권한만 갖되
 * 플레이어 명단({@code room:{code}:players})에는 들어가지 않는다. 참가자는 각자 폰으로
 * 접속해 컨트롤러가 된다.
 * <p>
 * 이 값이 필요한 이유는 호스트 검사 하나다 — 일반 방에서는 "hostId가 명단에도 있어야 한다"로
 * 방을 떠난 옛 호스트의 조작을 막지만, 파티 방의 호스트는 <b>정당하게</b> 명단에 없다.
 * 명단 유무만으로는 그 둘을 구분할 수 없어 방에 방식을 적어 둔다.
 */
public enum RoomMode {
    NORMAL,
    PARTY
}
