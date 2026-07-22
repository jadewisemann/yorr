package com.ssafy.yorr.handler;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class GameWebSocketHandler extends TextWebSocketHandler {

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
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception{
        System.out.println("받은 메시지: " + message.getPayload());
        // 지금은 그냥 로그만. 다음 단계에서 라우팅 붙이기
    }

    // 연결이 닫혔을 때 (콜센터: 전화 끊김)
    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        System.out.println("연결 닫힘: " + session.getId() + " / " + status);
    }
}
