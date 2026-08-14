package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * C→S: 끊겼다 돌아옴. 세션 토큰 제시 → 원래 방/상태 복원 요청. (SSOT: SysReconnectPayload)
 * lastMsgId 는 optional(있으면 서버가 그 이후만 재전송 가능).
 * ⚠️ transport 는 이정현, 상태 복원 로직은 재접속 티켓(25, 박재영)과 공동 → 지금은 DTO 만.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record SysReconnectPayload(
        String sessionToken,
        String lastMsgId
) {
}
