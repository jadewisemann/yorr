package com.ssafy.yorr.ws.dto;

import java.util.List;

public record DiceRollPayload(
        int roundNumber,
        int rollCount,
        List<Integer> dice
) {

    public DiceRollPayload {
        dice = dice == null ? null : List.copyOf(dice);
    }
}
