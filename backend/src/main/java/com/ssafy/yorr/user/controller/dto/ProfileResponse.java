package com.ssafy.yorr.user.controller.dto;

import com.ssafy.yorr.user.domain.User;

/**
 * 내 프로필. 소셜 제공자가 프로필 사진 동의를 주지 않으면 {@code profileImageUrl}은 비어 있고,
 * 클라이언트는 닉네임 첫 글자 아바타로 대신한다.
 */
public record ProfileResponse(String userId, String nickname, String profileImageUrl) {

    public static ProfileResponse of(User user) {
        return new ProfileResponse(user.getId(), user.getNickname(), user.getProfileImageUrl());
    }
}
