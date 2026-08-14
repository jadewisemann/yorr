package com.ssafy.yorr.ws.dto;

/**
 * S→C: 턴 주인이 사발을 던졌다. 이 굴림의 애니메이션을 지금 쏟으라는 신호. (SSOT: DiceThrownPayload)
 * <p>
 * 주사위 눈은 이미 dice.broadcast 로 나갔으므로 여기서 다시 싣지 않는다 — 어느 굴림인지
 * 가리키는 roundNumber · rollCount 만 있으면 된다.
 */
public record DiceThrownPayload(
        String playerId,
        int roundNumber,
        int rollCount
) {
}
