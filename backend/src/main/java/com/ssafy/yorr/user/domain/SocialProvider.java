package com.ssafy.yorr.user.domain;

/**
 * 소셜 로그인 제공자. DB에는 이름 문자열로 저장한다(순서가 바뀌어도 데이터가 어긋나지 않게).
 */
public enum SocialProvider {
    KAKAO,
    GOOGLE
}
