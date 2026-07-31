package com.ssafy.yorr.auth.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.time.Duration;

@Configuration
@EnableConfigurationProperties(AuthProperties.class)
public class AuthConfig {

    /**
     * 소셜 제공자 호출 전용 클라이언트.
     * <p>
     * 타임아웃을 반드시 건다 — 기본값은 무제한이라 카카오가 느려지면 로그인 요청이 그대로
     * 매달리고, 톰캣 스레드가 묶여 게임 요청까지 같이 느려진다.
     * <p>
     * 자동 구성된 {@code RestClient.Builder}를 주입받지 않고 직접 만든다 — 이 프로젝트의
     * 스타터 구성에는 그 빈이 없어서 주입하면 컨텍스트가 뜨지 않는다.
     */
    @Bean
    public RestClient socialRestClient() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(3));
        factory.setReadTimeout(Duration.ofSeconds(5));
        return RestClient.builder().requestFactory(factory).build();
    }
}
