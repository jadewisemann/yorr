package com.ssafy.yorr.ws;

/**
 * WebSocket 프로토콜 상수. 프론트 SSOT(ws-events.ts)의 상수와 값을 맞춘다.
 * 매직넘버를 핸들러에 흩뿌리지 않도록 여기 한 곳에 모은다.
 */
public final class WsProtocol {

    private WsProtocol() {
    }

    /** 프로토콜 버전. SSOT: WS_PROTOCOL_VERSION = 1. */
    public static final int PROTOCOL_VERSION = 1;

    /** 클라 하트비트 주기(ms). 서버는 이 값의 배수만큼 무응답이면 idle 종료(추후 25번 티켓). */
    public static final int HEARTBEAT_INTERVAL_MS = 30_000;
    public static final int HEARTBEAT_TIMEOUT_MULTIPLIER = 3;
    public static final long HEARTBEAT_TIMEOUT_MS =
            (long) HEARTBEAT_INTERVAL_MS * HEARTBEAT_TIMEOUT_MULTIPLIER;
}
