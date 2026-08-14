package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonInclude; // 애노테이션 = 옛 패키지

/**
 * 서버 → 클라이언트 봉투(송신용). 제네릭 P = payload 타입.
 * NON_NULL: roomId·msgId가 null이면 JSON에서 아예 빼서 계약(optional ?)과 맞춤.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record WsEnvelope<P>(
        String type,
        long ts,
        P payload,
        String roomId,
        String msgId
) {
    /** 방 밖/상관관계 없는 기본 송신. ts는 서버 시각 자동. */
    public static <P> WsEnvelope<P> of(String type, P payload) {
        return new WsEnvelope<>(type, System.currentTimeMillis(), payload, null, null);
    }

    /** 필요할 때만: 들어온 msgId를 그대로 되돌려주기(요청-응답 짝 맞춤). */
    public WsEnvelope<P> withMsgId(String msgId) {
        return new WsEnvelope<>(type, ts, payload, roomId, msgId);
    }

    /** 입장 이후 방 스코프 메시지: envelope.roomId를 채운다(계약: 입장 후 메시지에 roomId 존재). */
    public WsEnvelope<P> withRoomId(String roomId) {
        return new WsEnvelope<>(type, ts, payload, roomId, msgId);
    }
}