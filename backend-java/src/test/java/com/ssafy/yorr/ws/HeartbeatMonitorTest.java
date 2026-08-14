package com.ssafy.yorr.ws;

import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class HeartbeatMonitorTest {

    @Test
    void disconnectsOnlyAfterTheHeartbeatTimeout() {
        AtomicLong now = new AtomicLong(1_000L);
        HeartbeatMonitor monitor = new HeartbeatMonitor(now::get, 90_000L, false);
        WebSocketSession session = session("session-a");
        AtomicInteger timeouts = new AtomicInteger();
        monitor.track(session, timeouts::incrementAndGet);

        now.set(90_999L);
        monitor.disconnectIdleSessions();
        assertThat(timeouts).hasValue(0);

        now.set(91_000L);
        monitor.disconnectIdleSessions();
        monitor.disconnectIdleSessions();
        assertThat(timeouts).hasValue(1);
    }

    @Test
    void pingRefreshesTheSessionSpecificDeadline() {
        AtomicLong now = new AtomicLong(1_000L);
        HeartbeatMonitor monitor = new HeartbeatMonitor(now::get, 90_000L, false);
        WebSocketSession first = session("session-a");
        WebSocketSession second = session("session-b");
        AtomicInteger firstTimeouts = new AtomicInteger();
        AtomicInteger secondTimeouts = new AtomicInteger();
        monitor.track(first, firstTimeouts::incrementAndGet);
        monitor.track(second, secondTimeouts::incrementAndGet);

        now.set(61_000L);
        monitor.recordPing(first);
        now.set(91_000L);
        monitor.disconnectIdleSessions();

        assertThat(firstTimeouts).hasValue(0);
        assertThat(secondTimeouts).hasValue(1);
    }

    private static WebSocketSession session(String id) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        return session;
    }
}
