package com.ssafy.yorr.handler;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.ssafy.yorr.ws.dto.InboundEnvelope;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import com.ssafy.yorr.ws.dto.SysPongPayload;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import tools.jackson.databind.ObjectMapper;   // ← Jackson 3 (Boot 4)

import java.io.IOException;

@Component
public class GameWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(GameWebSocketHandler.class);
    private final ObjectMapper objectMapper; // Boot4가 만드는 JsonMapper 빈이 여기 주입됨

    public GameWebSocketHandler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    // 연결이 열렸을 때 (콜센터: 전화 받음)
    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        System.out.println("연결 열림: " + session.getId());

        String greeting = """
            {"type":"sys.connected","ts":%d,"payload":{"serverTs":%d,"protocolVersion":1,"heartbeatIntervalMs":30000}}
            """.formatted(System.currentTimeMillis(), System.currentTimeMillis()); // JSON을 손으로 문자열로 썼는데, 이건 임시 (DTO + Jackson으로 깔끔하게 바꿀 예정)

        session.sendMessage(new TextMessage(greeting));
    }

    // 클라이언트가 메시지를 보냈을 때 (콜센터: 손님 말 들음)
    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        // 1) 봉투만 먼저 파싱 (payload는 JsonNode로 남겨둠)
        InboundEnvelope in;
        try {
            in = objectMapper.readValue(message.getPayload(), InboundEnvelope.class);
        } catch (Exception e) {
            // 메시지 경계 방어: 깨진 프레임 하나가 핸들러를 죽이지 않게 삼킨다
            log.warn("깨진 WS 메시지 무시: {}", message.getPayload(), e);
            return;
        }

        // 2) 봉투 라벨(type)만 보고 담당 핸들러로 배달
        switch (in.type()) {
            case "sys.ping" -> handleSysPing(session, in);
            // 다음 단계에서 하나씩:
            // case "room.join"     -> handleRoomJoin(session, in);
            // case "room.leave"    -> handleRoomLeave(session, in);
            // case "reaction.send" -> handleReactionSend(session, in);
            default -> log.debug("아직 라우팅 안 붙은 type: {}", in.type());
        }
    }

    // 연결이 닫혔을 때 (콜센터: 전화 끊김)
    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        System.out.println("연결 닫힘: " + session.getId() + " / " + status);
    }

    /** sys.ping → sys.pong. pong은 서버 시각만 돌려주면 됨. */
    private void handleSysPing(WebSocketSession session, InboundEnvelope in) throws IOException {
        // ping의 clientTs는 클라가 RTT/시계오프셋 계산에 씀 → 서버는 안 봐도 OK
        WsEnvelope<SysPongPayload> pong =
                WsEnvelope.of("sys.pong", new SysPongPayload(System.currentTimeMillis()));
        send(session, pong);
    }

    /** 공통 송신 헬퍼: 봉투 → JSON 문자열 → 소켓 전송. */
    private void send(WebSocketSession session, WsEnvelope<?> envelope) throws IOException {
        String json = objectMapper.writeValueAsString(envelope);
        session.sendMessage(new TextMessage(json));
    }
}
