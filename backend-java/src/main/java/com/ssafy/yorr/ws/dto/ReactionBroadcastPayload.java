package com.ssafy.yorr.ws.dto;

/** S→C: 리액션 브로드캐스트. (SSOT: ReactionBroadcastPayload) */
public record ReactionBroadcastPayload(
        String playerId,
        ReactionType reaction
) {
}
