package com.ssafy.yorr.ws.dto;

import java.util.List;

public record RoundStartPayload(
        int roundNumber,
        long deadline,
        String activePlayerId,
        /**
         * 서버가 확정한 턴 순서(참가자 playerId). 클라가 명단 정렬로 순서를 추측하지 않게 그대로 싣는다.
         * 방 명단(room.joined·state.sync)의 players 순서는 순서를 보장하지 않는다.
         */
        List<String> turnOrder
) {

    public RoundStartPayload {
        turnOrder = turnOrder == null ? List.of() : List.copyOf(turnOrder);
    }
}
