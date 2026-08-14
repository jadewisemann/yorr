package com.ssafy.yorr.user.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 회원과 소셜 계정의 연결. {@code (provider, providerUserId)}가 로그인 조회의 열쇠다.
 * <p>
 * 회원 테이블에 provider별 컬럼을 두지 않고 이렇게 분리한 이유는, 한 회원이 카카오와
 * 구글을 함께 연결할 수 있고 provider가 늘어도 스키마를 바꾸지 않기 위해서다.
 */
@Entity
@Table(name = "social_accounts")
@Getter
public class SocialAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false, updatable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20, updatable = false)
    private SocialProvider provider;

    /** 제공자가 부여한 고유 식별자. 카카오는 숫자지만 제공자마다 형태가 달라 문자열로 받는다. */
    @Column(name = "provider_user_id", nullable = false, length = 64, updatable = false)
    private String providerUserId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    protected SocialAccount() {
    }

    private SocialAccount(User user, SocialProvider provider, String providerUserId) {
        this.user = user;
        this.provider = provider;
        this.providerUserId = providerUserId;
    }

    public static SocialAccount link(User user, SocialProvider provider, String providerUserId) {
        if (user == null) throw new IllegalArgumentException("user must not be null");
        if (provider == null) throw new IllegalArgumentException("provider must not be null");
        if (providerUserId == null || providerUserId.isBlank()) {
            throw new IllegalArgumentException("providerUserId must not be blank");
        }
        return new SocialAccount(user, provider, providerUserId);
    }
}
