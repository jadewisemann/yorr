package com.ssafy.yorr.ws;

import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

/**
 * 세션별 마지막 heartbeat를 추적하고 제한 시간을 넘긴 연결을 종료 경로로 보낸다.
 * 실제 disconnect 프레임 전송과 소켓 close는 핸들러가 넘긴 콜백의 책임이다.
 */
@Component
public class HeartbeatMonitor {

    private final Map<String, TrackedSession> sessions = new ConcurrentHashMap<>();
    private final LongSupplier nowMillis;
    private final long timeoutMillis;
    private final ScheduledExecutorService executor;

    public HeartbeatMonitor() {
        this(System::currentTimeMillis, WsProtocol.HEARTBEAT_TIMEOUT_MS, true);
    }

    HeartbeatMonitor(LongSupplier nowMillis, long timeoutMillis, boolean startScheduler) {
        this.nowMillis = nowMillis;
        this.timeoutMillis = timeoutMillis;
        this.executor = startScheduler ? newExecutor() : null;
        if (executor != null) {
            executor.scheduleAtFixedRate(
                    this::disconnectIdleSessions,
                    WsProtocol.HEARTBEAT_INTERVAL_MS,
                    WsProtocol.HEARTBEAT_INTERVAL_MS,
                    TimeUnit.MILLISECONDS
            );
        }
    }

    public void track(WebSocketSession session, Runnable timeoutAction) {
        sessions.put(
                session.getId(),
                new TrackedSession(session, nowMillis.getAsLong(), timeoutAction)
        );
    }

    public void recordPing(WebSocketSession session) {
        sessions.computeIfPresent(session.getId(), (id, tracked) ->
                new TrackedSession(tracked.session(), nowMillis.getAsLong(), tracked.timeoutAction()));
    }

    public void untrack(WebSocketSession session) {
        sessions.remove(session.getId());
    }

    void disconnectIdleSessions() {
        long now = nowMillis.getAsLong();
        sessions.forEach((sessionId, tracked) -> {
            if (now - tracked.lastPingAtMillis() < timeoutMillis) {
                return;
            }
            // ping과 경합해 값이 갱신됐으면 remove가 실패하므로 살아 있는 세션을 끊지 않는다.
            if (sessions.remove(sessionId, tracked)) {
                tracked.timeoutAction().run();
            }
        });
    }

    @PreDestroy
    void shutdown() {
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    private static ScheduledExecutorService newExecutor() {
        return Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "websocket-heartbeat");
            thread.setDaemon(true);
            return thread;
        });
    }

    private record TrackedSession(
            WebSocketSession session,
            long lastPingAtMillis,
            Runnable timeoutAction
    ) {
    }
}
