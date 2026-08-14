package com.ssafy.yorr.config;

import com.ssafy.yorr.handler.GameWebSocketHandler;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
@EnableConfigurationProperties(CorsProperties.class)
public class WebSocketConfig implements WebSocketConfigurer {
    private final GameWebSocketHandler gameWebSocketHandler;
    private final CorsProperties cors;

    public WebSocketConfig(GameWebSocketHandler gameWebSocketHandler, CorsProperties cors) {
        this.gameWebSocketHandler = gameWebSocketHandler;
        this.cors = cors;
    }

    /**
     * 허용 출처는 REST(WebConfig)와 <b>같은 설정값</b>을 쓴다. 예전에는 두 파일에 목록을
     * 복사해 뒀는데, 그러면 한쪽만 고쳤을 때 REST는 막히고 WebSocket은 열려 있는 상태가 된다.
     */
    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry
                .addHandler(gameWebSocketHandler, "/ws/v1/game")
                .setAllowedOrigins(cors.originsArray());
    }
}
