package com.ssafy.yorr.ws.dto;

/**
 * 공통 에러 코드. error 메시지(ErrorPayload)에 실린다. (SSOT: WsErrorCode)
 * 계약 문자열이 이미 UPPER_SNAKE 라 자바 상수명(name())과 1:1 → 별도 wire 매핑 불필요.
 * (Jackson 기본 enum 직렬화가 name() 을 그대로 쓴다.)
 */
public enum WsErrorCode {
    AUTH_REQUIRED,
    AUTH_FAILED,
    SESSION_EXPIRED,
    ROOM_NOT_FOUND,
    ROOM_FULL,
    NOT_IN_ROOM,
    ALREADY_IN_ROOM,
    GAME_ALREADY_STARTED,
    /** 내 턴이 아닌데 굴림·기록을 시도했다. 클라이언트는 조작을 되돌리고 안내만 띄운다. */
    NOT_YOUR_TURN,
    INVALID_MESSAGE,
    RATE_LIMITED,
    INTERNAL
}
