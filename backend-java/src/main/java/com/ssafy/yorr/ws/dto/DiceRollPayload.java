package com.ssafy.yorr.ws.dto;

import java.util.List;

public record DiceRollPayload(
        int roundNumber,
        int rollCount,
        List<Boolean> held
) {

    public DiceRollPayload {
        held = held == null ? null : List.copyOf(held);
    }
}
