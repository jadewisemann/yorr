package com.ssafy.yorr.ws.dto;

import tools.jackson.databind.JsonNode; // databind = Jackson 3 (InboundEnvelope와 같은 타입이어야 한다)

/**
 * S→C: 누가 나에게 보낸 시그널. (SSOT: VoiceSignaledPayload)
 * <p>
 * {@code from}은 서버가 registry에서 꺼내 채운 값이라 신뢰할 수 있다.
 * {@code data}는 받은 그대로 흘려보낸다({@link VoiceSignalPayload} 참고).
 */
public record VoiceSignaledPayload(String from, JsonNode data) {
}
