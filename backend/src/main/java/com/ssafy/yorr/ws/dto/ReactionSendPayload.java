package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** C→S: 리액션 전송. (SSOT: ReactionSendPayload) */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ReactionSendPayload(ReactionType reaction) {
}
