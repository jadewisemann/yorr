package com.ssafy.yorr.ws.dto;

import java.util.List;

/**
 * C→S: 굴림 사이에 KEEP을 바꿨다고 알린다. (SSOT: DiceHoldPayload)
 * <p>
 * dice.roll 의 held 는 "그 굴림에 쓴 KEEP"이라, 굴린 뒤에 바꾼 KEEP은 다음 굴림 전까지 서버도
 * 상대도 알 수 없었다. 증분이 아니라 전체 배열을 받는다 — 한 번 놓쳐도 다음 토글에서 복구된다.
 */
public record DiceHoldPayload(
        int roundNumber,
        List<Boolean> held
) {

    public DiceHoldPayload {
        held = held == null ? null : List.copyOf(held);
    }
}
