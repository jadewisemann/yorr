package com.ssafy.yorr.ws.voice;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 음성 통화를 시작할 때 필요한 ICE 서버 목록을 내려준다.
 * <p>
 * WebSocket이 아니라 REST인 이유: TURN 자격증명은 <b>시간제한 토큰</b>이라 방 전체에
 * 브로드캐스트하면 안 된다. voice.peers에 실어 보내면 방에 있는 모든 사람이 남의 자격증명을
 * 갖게 된다.
 */
@RestController
@RequestMapping("/api/v1/voice")
@CrossOrigin("*")
@RequiredArgsConstructor
@Tag(name = "Voice", description = "음성 채팅 WebRTC 설정 API")
public class VoiceIceController {

    private final VoiceIceService ice;

    @GetMapping("/ice")
    @Operation(summary = "WebRTC ICE 서버 목록(TURN 자격증명 포함) 발급")
    public ResponseEntity<VoiceIceService.VoiceIceConfig> iceServers(
            // 발급 식별자로만 쓴다. 없으면 익명으로 발급한다 — 게스트도 통화에 참여하므로
            // 로그인을 전제할 수 없고, 자격증명의 보안은 secret과 만료 시각이 담당한다.
            @RequestHeader(value = "X-User-Id", required = false) String userId
    ) {
        return ResponseEntity.ok(ice.configFor(userId == null || userId.isBlank() ? "guest" : userId));
    }
}
