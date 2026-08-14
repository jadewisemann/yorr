package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties; // 애노테이션 = 옛 패키지
import tools.jackson.databind.JsonNode;                       // databind = Jackson 3 새 패키지

/**
 * C→S: 지목한 상대에게 시그널을 전달해 달라는 요청. (SSOT: VoiceSignalPayload)
 * <p>
 * {@code data}는 <b>JsonNode로 남긴다</b>. 안에는 SDP·ICE 후보가 들어오는데, 서버가 이걸
 * 타입으로 뜯으면 브라우저가 WebRTC 규격을 늘릴 때마다 서버도 같이 고쳐야 한다. 봉투만 보고
 * 배달하면 그 일이 사라진다 — 계약(wsEvents.ts)이 명시한 규칙이다.
 * <p>
 * {@code from}은 여기 없다. 클라이언트가 주장하는 신분을 믿으면 남을 사칭할 수 있어
 * 서버가 registry에서 꺼내 채운다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record VoiceSignalPayload(String to, JsonNode data) {
}
