package com.ssafy.yorr.ws.dto;

/**
 * S→C: 턴 주인이 사발을 흔들었다. 관전 화면이 이 펄스를 그대로 자기 사발에 먹인다.
 * (SSOT: DiceShakenPayload)
 * <p>
 * 주사위 눈과는 무관한 연출 신호라 어느 턴인지(roundNumber)와 흔든 방향 · 세기만 싣는다.
 */
public record DiceShakenPayload(
        String playerId,
        int roundNumber,
        String direction,
        double strength
) {
}
