package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties; // 애노테이션 = 옛 패키지
import tools.jackson.databind.JsonNode;                       // databind = Jackson 3 새 패키지

/**
 * 클라이언트 → 서버 봉투(수신 전용).
 * payload를 타입으로 바로 안 받고 JsonNode(날것)로 들고 있는 게 포인트.
 * type이 뭔지 본 뒤, 각 핸들러가 자기 payload만 DTO로 변환한다(2단계 파싱).
 * (Java 제네릭 소거 때문에 WsEnvelope<SysPingPayload>로 한 방 역직렬화가 안 됨)
 */
@JsonIgnoreProperties(ignoreUnknown = true) // 클라가 모르는 필드 더 보내도 안 터지게
public record InboundEnvelope(
        String type,      // 판별자. 라우팅의 유일한 기준.
        Long ts,          // 클라가 채운 시각(없을 수도 있어 박싱). 지금은 안 씀.
        JsonNode payload, // type마다 모양이 달라 여기선 날것. 핸들러가 해석.
        String roomId,    // 입장 후 방 스코프 메시지에 존재. 지금은 안 씀.
        String msgId      // ack/상관관계용(선택). pong에서 echo 가능.
) {}