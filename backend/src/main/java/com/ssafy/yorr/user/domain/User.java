package com.ssafy.yorr.user.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 소셜 로그인으로 가입한 회원. 게스트는 여기 없다 — Redis의 {@code user:{id}}에만 존재한다.
 * <p>
 * 식별자를 UUID 문자열로 두는 이유는 게스트와 같은 형태를 쓰기 위해서다. X-User-Id 헤더 ·
 * Redis 키 · 방 참가자 명단이 전부 이 문자열을 그대로 쓰므로, 회원이 게임에 들어갈 때
 * 게스트 경로와 다른 변환을 거치지 않는다.
 */
@Entity
@Table(name = "users")
@Getter
public class User {

    @Id
    @Column(length = 36, nullable = false, updatable = false)
    private String id;

    /** 프로필 닉네임. 방에서 쓰는 표시명의 기본값이 된다(방마다 바꿀 수 있다). 고유하지 않다. */
    @Column(nullable = false, length = 20)
    private String nickname;

    /** 소셜 프로필 이미지 URL. 동의하지 않으면 받을 수 없으므로 nullable이다. */
    @Column(name = "profile_image_url", length = 500)
    private String profileImageUrl;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected User() {
    }

    private User(String id, String nickname, String profileImageUrl) {
        this.id = id;
        this.nickname = nickname;
        this.profileImageUrl = profileImageUrl;
    }

    /** 소셜 프로필로 새 회원을 만든다. 식별자는 저장 전에 애플리케이션이 정한다(게스트와 같은 규칙). */
    public static User create(String nickname, String profileImageUrl) {
        if (nickname == null || nickname.isBlank()) {
            throw new IllegalArgumentException("nickname must not be blank");
        }
        return new User(UUID.randomUUID().toString(), nickname, profileImageUrl);
    }
}
