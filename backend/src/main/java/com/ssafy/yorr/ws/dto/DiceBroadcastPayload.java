package com.ssafy.yorr.ws.dto;

import java.util.List;

/**
 * 서버가 확정한 굴림 결과.
 *
 * @param auto 마감 시각이 지나 서버가 플레이어를 대신해 굴린 결과인지. 클라이언트는 이 값이 true면
 *             자기가 보낸 dice.roll의 응답이 아니어도 결과를 그대로 반영해야 한다.
 */
public record DiceBroadcastPayload(
        String playerId,
        int roundNumber,
        int rollCount,
        List<Integer> dice,
        List<Boolean> held,
        boolean auto
) {

    public DiceBroadcastPayload {
        dice = List.copyOf(dice);
        held = List.copyOf(held);
    }
}
