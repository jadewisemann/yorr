package com.ssafy.yorr.ws.voice;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;

/**
 * WebRTC ICE 서버 목록을 만든다. 브라우저의 {@code RTCConfiguration.iceServers}로 그대로 간다.
 * <p>
 * TURN 자격증명을 <b>REST로 발급하는 이유</b>: 고정 ID/비밀번호를 쓰면 프론트 JavaScript에
 * 그대로 노출돼 외부인이 우리 중계 대역폭을 공짜로 쓴다. coturn의 {@code use-auth-secret}
 * 방식으로 짧은 수명의 자격증명을 그때그때 만든다.
 * <p>
 * TURN이 설정되지 않은 환경(로컬 개발·인프라 구축 전)에서는 <b>STUN만</b> 돌려준다. 같은
 * NAT 안에서는 그것만으로 통화가 붙으므로 개발이 막히지 않는다 — 프론트도 같은 판단으로
 * 실패 시 공용 STUN으로 떨어진다({@code realtime/voice/iceServers.ts}).
 */
@Service
public class VoiceIceService {

    /** coturn의 static-auth-secret과 같은 값. 비어 있으면 TURN을 내보내지 않는다. */
    private final String turnSecret;
    /** coturn이 떠 있는 호스트(예: i15a406.p.ssafy.io). 비어 있으면 TURN을 내보내지 않는다. */
    private final String turnHost;
    private final String stunUrl;
    private final long credentialTtlSeconds;

    public VoiceIceService(
            @Value("${yorr.voice.turn.secret:}") String turnSecret,
            @Value("${yorr.voice.turn.host:}") String turnHost,
            @Value("${yorr.voice.stun-url:stun:stun.l.google.com:19302}") String stunUrl,
            @Value("${yorr.voice.turn.ttl-seconds:600}") long credentialTtlSeconds
    ) {
        this.turnSecret = turnSecret;
        this.turnHost = turnHost;
        this.stunUrl = stunUrl;
        this.credentialTtlSeconds = credentialTtlSeconds;
    }

    /**
     * @param identifier 자격증명에 섞는 식별자(playerId 등). 서버 로그에서 어느 발급인지 알아보는 용도라
     *                   비밀이 아니어도 된다 — 보안은 secret과 만료 시각이 담당한다.
     */
    public VoiceIceConfig configFor(String identifier) {
        List<IceServer> servers = new java.util.ArrayList<>();
        servers.add(new IceServer(List.of(stunUrl), null, null));

        if (!turnSecret.isBlank() && !turnHost.isBlank()) {
            String username = (Instant.now().getEpochSecond() + credentialTtlSeconds) + ":" + identifier;
            servers.add(new IceServer(
                    List.of(
                            "turn:" + turnHost + ":3478?transport=udp",
                            "turn:" + turnHost + ":3478?transport=tcp",
                            // TLS 5349는 UDP가 막힌 망에서 유일하게 통과하는 경로다.
                            "turns:" + turnHost + ":5349?transport=tcp"
                    ),
                    username,
                    sign(username)
            ));
        }
        return new VoiceIceConfig(List.copyOf(servers), credentialTtlSeconds);
    }

    /** coturn REST 규약: credential = base64(HMAC-SHA1(secret, username)). */
    private String sign(String username) {
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(turnSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA1"));
            return Base64.getEncoder().encodeToString(mac.doFinal(username.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            // secret이 잘못돼도 통화 전체를 막지 않는다 — STUN만으로 붙는 조합은 그대로 동작한다.
            throw new IllegalStateException("TURN 자격증명 생성 실패", e);
        }
    }

    /** 브라우저 RTCIceServer와 같은 모양. null 필드는 직렬화에서 빠진다. */
    public record IceServer(List<String> urls, String username, String credential) {}

    /** SSOT: iceServers + ttlSeconds (frontend realtime/voice/iceServers.ts와 같은 계약). */
    public record VoiceIceConfig(List<IceServer> iceServers, long ttlSeconds) {}
}
