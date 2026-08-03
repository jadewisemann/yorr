package com.ssafy.yorr.room.dto;

/**
 * 방의 진행 방식.
 * <p>
 * {@code NORMAL} — 방을 만든 사람도 플레이어다(기존 동작).
 * <p>
 * {@code PARTY} — 방을 만든 화면은 <b>대시보드</b>다. 게임을 비추기만 하고 플레이어 명단
 * ({@code room:{code}:players})에도, 방장 자리에도 들어가지 않는다. 참가자는 각자 폰으로
 * 접속해 컨트롤러가 되고, <b>처음 들어온 컨트롤러가 방장</b>이 된다(조작은 폰에서 한다).
 * <p>
 * 이 값이 필요한 이유는 <b>방의 수명</b>이다 — 일반 방은 마지막 참가자가 나가면 지워지지만,
 * 대시보드는 명단에 없어 members에 세어지지 않는다. 그대로 두면 컨트롤러 하나가 잘못 들어왔다
 * 나가는 것만으로 members가 0이 되어, 아직 QR을 띄우고 사람을 기다리는 방이 사라진다.
 * 명단이 비었다는 사실만으로는 그 둘을 구분할 수 없어 방에 방식을 적어 둔다
 * (자세한 규약은 {@code RoomValidationService}의 {@code LEAVE}).
 */
public enum RoomMode {
    NORMAL,
    PARTY
}
