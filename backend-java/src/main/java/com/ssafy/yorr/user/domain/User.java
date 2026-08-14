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

    /**
     * 제공자가 닉네임을 주지 않았을 때 쓰는 임시 이름(동의항목이 꺼져 있거나 사용자가 거절한 경우).
     * <p>
     * "이 이름은 사용자가 고른 것이 아니다"라는 표시이기도 하다 — 나중에 진짜 이름을 받으면
     * 덮어써도 되는 값인지 판단하는 근거가 된다.
     */
    public static final String PLACEHOLDER_NICKNAME = "플레이어";

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

    /**
     * 사용자가 직접 이름을 정한다. 이 뒤로는 로그인해도 제공자 이름으로 덮이지 않는다
     * ({@link #adoptProviderProfile}은 임시 이름일 때만 동작한다).
     */
    public void rename(String nickname) {
        if (nickname == null || nickname.isBlank()) {
            throw new IllegalArgumentException("invalid_nickname");
        }
        this.nickname = nickname;
    }

    /** 사용자가 고르지 않은 임시 이름을 쓰고 있는지. 그렇다면 제공자가 준 진짜 이름으로 바꿔도 된다. */
    public boolean hasPlaceholderNickname() {
        return PLACEHOLDER_NICKNAME.equals(nickname);
    }

    /**
     * 제공자에게서 받은 프로필로 갱신한다. <b>임시 이름을 쓰고 있을 때만 부른다</b> —
     * 사용자가 직접 정한 이름(151)을 로그인할 때마다 덮어쓰면 바꿀 방법이 없어진다.
     */
    public void adoptProviderProfile(String nickname, String profileImageUrl) {
        if (nickname != null && !nickname.isBlank()) this.nickname = nickname;
        if (profileImageUrl != null && !profileImageUrl.isBlank()) this.profileImageUrl = profileImageUrl;
    }
}
