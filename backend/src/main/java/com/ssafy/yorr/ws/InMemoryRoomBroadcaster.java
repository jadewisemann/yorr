package com.ssafy.yorr.ws;

import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class InMemoryRoomBroadcaster implements RoomBroadcaster {

    private static final String ROOM_ID_ATTR = "roomId";

    private final Map<String, Set<WebSocketSession>> rooms = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper;

    public InMemoryRoomBroadcaster(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /** 방에 세션 등록. room.join 처리 때 호출. */
    public void register(String roomId, WebSocketSession session) {
        session.getAttributes().put(ROOM_ID_ATTR, roomId);
        rooms.computeIfAbsent(roomId, k -> ConcurrentHashMap.newKeySet())
                .add(session);
    }

    /** 세션 해제. afterConnectionClosed에서 호출. */
    public void unregister(WebSocketSession session) {
        Object roomId = session.getAttributes().get(ROOM_ID_ATTR);
        if (roomId == null) return;
        Set<WebSocketSession> peers = rooms.get(roomId);
        if (peers == null) return;
        peers.remove(session);
        if (peers.isEmpty()) rooms.remove(roomId);
    }

    @Override
    public void broadcast(String roomId, WsEnvelope<?> message) {
        Set<WebSocketSession> peers = rooms.get(roomId);
        if (peers == null || peers.isEmpty()) return;

        String json = objectMapper.writeValueAsString(message);
        TextMessage frame = new TextMessage(json);

        for (WebSocketSession session : peers) {
            if (!session.isOpen()) continue;
            try {
                synchronized (session) {
                    session.sendMessage(frame);
                }
            } catch (IOException e) {
                // 죽은 소켓 하나가 전체 방송을 깨지 않게 개별 catch.
                // 실제 제거는 unregister(afterConnectionClosed)가 담당.
            }
        }
    }
}