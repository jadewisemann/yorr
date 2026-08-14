package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * C→S (JOIN): 인증 + 방 입장 통합. 소켓 열고 보내는 사실상 첫 메시지. (SSOT: RoomJoinPayload)
 *  - roomId       : 대상 방(REST 로 방 생성·정원검증 후 확보한 id).
 *  - nickname     : 표시 이름.
 *  - sessionToken : optional. 있으면 기존 세션 이어받기(재입장/중복세션 → 기존 대체), 없으면 신규 발급.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RoomJoinPayload(
        String roomId,
        String nickname,
        String sessionToken
) {
}
