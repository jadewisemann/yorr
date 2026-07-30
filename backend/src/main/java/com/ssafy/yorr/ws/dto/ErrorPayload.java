package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Map;

/**
 * S→C: 공통 에러. (SSOT: ErrorPayload)
 *  - refMsgId : optional. 문제된 원본 msgId(있으면) — 클라가 어떤 요청 실패인지 매칭.
 *  - context  : optional. 부가 정보(SSOT: Record<string, unknown>).
 * NON_NULL: optional 필드가 null 이면 JSON 에서 빼서 계약(?)과 맞춘다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorPayload(
        WsErrorCode code,
        String message,
        String refMsgId,
        Map<String, Object> context
) {
}
