package com.ssafy.yorr.user;

/**
 * 세션 토큰이 없거나 만료·불일치일 때. <b>닉네임 규칙 위반과 구분하기 위해</b> 존재한다.
 * <p>
 * 둘이 같은 예외였을 때는 토큰 만료도 "닉네임이 올바르지 않습니다"로 응답됐고, 클라이언트는
 * 그 코드(INVALID_MESSAGE)를 세션 종료로 다루지 않아 대기실에서 아무 안내 없이 멈췄다.
 * 타입을 갈라 두면 호출부가 만료를 SESSION_EXPIRED로 알릴 수 있고, 클라이언트의 재입장 복구
 * 경로가 그대로 동작한다.
 * <p>
 * {@link IllegalArgumentException}을 상속하는 이유: REST 컨트롤러들이 이미
 * {@code catch (IllegalArgumentException) → 401}로 인증 실패를 처리하고 있어, 그 경로를
 * 건드리지 않고 WebSocket 쪽만 세분화하기 위해서다.
 */
public class SessionAuthenticationException extends IllegalArgumentException {

    private static final String REASON = "invalid_guest_session";

    public SessionAuthenticationException() {
        super(REASON);
    }
}
