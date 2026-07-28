package com.ssafy.yorr.ws.dto;

import java.util.List;

public record DiceBroadcastPayload(
        String playerId,
        int roundNumber,
        int rollCount,
        List<Integer> dice,
        List<Boolean> held
) {

    public DiceBroadcastPayload {
        dice = List.copyOf(dice);
        held = List.copyOf(held);
    }
}
