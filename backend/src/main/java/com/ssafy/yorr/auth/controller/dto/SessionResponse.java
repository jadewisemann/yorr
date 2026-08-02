package com.ssafy.yorr.auth.controller.dto;

/**
 * 로그인 결과. sessionToken은 게스트가 쓰던 것과 같은 형태라, 클라이언트는 회원이든
 * 게스트든 같은 방식으로 방에 입장한다.
 */
public record SessionResponse(String userId, String nickname, String type, String sessionToken) {
}
