package com.ssafy.yorr.ws.dto;

import java.util.List;

public record RoundSubmitPayload(
        int roundNumber,
        List<Integer> dice,
        String category
) {

    public RoundSubmitPayload {
        dice = dice == null ? null : List.copyOf(dice);
    }
}
