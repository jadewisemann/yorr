package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * C→S: 앱 레벨 하트비트. (SSOT: SysPingPayload)
 * clientTs 는 클라가 RTT/시계오프셋 계산에 쓰는 값 → 서버는 보통 안 본다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record SysPingPayload(long clientTs) {
}
