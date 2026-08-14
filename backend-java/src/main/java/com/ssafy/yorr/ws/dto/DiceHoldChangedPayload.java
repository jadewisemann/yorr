package com.ssafy.yorr.ws.dto;

import java.util.List;

/**
 * S→C: 턴 주인의 KEEP이 바뀌었다. (SSOT: DiceHoldChangedPayload)
 * <p>
 * 주사위 값은 그대로이므로 dice.broadcast 를 재사용하지 않는다 — 그쪽은 클라이언트에서 굴림
 * 애니메이션을 트리거하기 때문에, KEEP만 바뀐 상황에 쓰면 주사위가 다시 굴러가 버린다.
 */
public record DiceHoldChangedPayload(
        String playerId,
        int roundNumber,
        List<Boolean> held
) {

    public DiceHoldChangedPayload {
        held = List.copyOf(held);
    }
}
