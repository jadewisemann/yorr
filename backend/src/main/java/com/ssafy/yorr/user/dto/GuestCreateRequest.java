package com.ssafy.yorr.user.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 방 생성·참가 요청.
 *
 * @param sessionToken 로그인한 사용자의 세션 토큰(선택). 있으면 새 게스트를 만들지 않고 그
 *                     회원으로 입장한다 — 이게 없으면 로그인해도 방에 들어가는 순간 게스트가
 *                     되어 전적이 계정에 남지 않는다. 토큰이 만료됐으면 게스트로 되돌아간다.
 */
public record GuestCreateRequest(
        String nickname,
        @JsonProperty("room_id") String roomId,
        @JsonProperty("session_token") String sessionToken
) {}
