package com.ssafy.yorr.handler;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.ssafy.yorr.ws.WsProtocol;
import com.ssafy.yorr.ws.dto.InboundEnvelope;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import com.ssafy.yorr.ws.dto.SysConnectedPayload;
import com.ssafy.yorr.ws.dto.SysPongPayload;
import com.ssafy.yorr.ws.dto.ErrorPayload;
import com.ssafy.yorr.ws.dto.WsErrorCode;

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
        log.info("연결 열림: {}", session.getId());

        // 인증(room.join) 전에 먼저 보내는 서버 인사. 손으로 쓰던 JSON을 DTO + Jackson으로 교체.
        WsEnvelope<SysConnectedPayload> connected = WsEnvelope.of(
                "sys.connected",
                new SysConnectedPayload(
                        System.currentTimeMillis(),
                        WsProtocol.PROTOCOL_VERSION,
                        WsProtocol.HEARTBEAT_INTERVAL_MS));
        send(session, connected);
    }

    // 클라이언트가 메시지를 보냈을 때 (콜센터: 손님 말 들음)
    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        // 1) 봉투만 먼저 파싱 (payload는 JsonNode로 남겨둠)
        InboundEnvelope in;
        try {
            in = objectMapper.readValue(message.getPayload(), InboundEnvelope.class);
        } catch (Exception e) {
            log.warn("깨진 WS 메시지: {}", message.getPayload(), e);
            sendError(session, WsErrorCode.INVALID_MESSAGE, "메시지 형식이 올바르지 않습니다.", null);
            return;
        }

        // 2) 봉투 라벨(type)만 보고 담당 핸들러로 배달
        switch (in.type()) {
            case "sys.ping" -> handleSysPing(session, in);
            // DTO 는 ws.dto 에 미러링 완료. 아래는 세션/방 레지스트리가 생기면 붙인다:
            //   case "sys.reconnect" -> handleSysReconnect(session, in);   // 상태 복원(25번 티켓, 박재영)과 공동
            //   case "room.join"     -> handleRoomJoin(session, in);       // RoomJoinPayload
            //   case "room.leave"    -> handleRoomLeave(session, in);      // RoomLeavePayload
            //   case "room.ready"    -> handleRoomReady(session, in);      // RoomReadyPayload
            //   case "reaction.send" -> handleReactionSend(session, in);   // ReactionSendPayload
            default -> log.debug("아직 라우팅 안 붙은 type: {}", in.type());
        }
    }

    // 연결이 닫혔을 때 (콜센터: 전화 끊김)
    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        log.info("연결 닫힘: {} / {}", session.getId(), status);
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

    /** 표준 에러 응답. refMsgId =  어떤 요청 실패인지 매칭용(없으면 null). **/
    private void sendError(WebSocketSession session, WsErrorCode code, String message, String refMsgID) throws IOException{
        send(session, WsEnvelope.of("error", new ErrorPayload(code, message, refMsgID, null)));
    }
}
