package com.ssafy.yorr.auth;

/**
 * 소셜 로그인 실패. 실패 사유를 프론트가 화면에 매핑할 수 있도록 코드로 구분한다.
 * <p>
 * 사유를 하나로 뭉개면 사용자가 "다시 시도"로 풀 수 있는 실패와 그렇지 않은 실패를
 * 구분할 수 없다(소셜 로그인 도입 때 겪은 것과 같은 문제).
 */
public class SocialLoginException extends RuntimeException {

    private final Reason reason;

    public SocialLoginException(Reason reason) {
        this(reason, reason.name().toLowerCase(), null);
    }

    public SocialLoginException(Reason reason, String message, Throwable cause) {
        super(message, cause);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }

    public enum Reason {
        /** 환경변수가 없어 로그인 자체를 시작할 수 없다. 운영 설정 문제다. */
        NOT_CONFIGURED,
        /** 우리가 발급하지 않았거나 이미 쓰인 state. 재시도로 풀린다. */
        INVALID_STATE,
        /** 사용자가 동의 화면에서 취소했다. */
        CANCELED,
        /** 제공자와의 통신 실패 또는 제공자가 코드를 거절함. */
        PROVIDER_ERROR
    }
}
