package com.ssafy.yorr.user.controller.dto;

/** 닉네임 변경 요청. 규칙은 게스트 생성과 같다(1~20자). */
public record RenameRequest(String nickname) {}
