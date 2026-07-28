package com.ssafy.yorr.ws.dto;

public record RoundStartPayload(
        int roundNumber,
        long deadline,
        String activePlayerId
) {
}
