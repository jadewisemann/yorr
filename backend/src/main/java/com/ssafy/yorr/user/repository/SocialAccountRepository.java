package com.ssafy.yorr.user.repository;

import com.ssafy.yorr.user.domain.SocialAccount;
import com.ssafy.yorr.user.domain.SocialProvider;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface SocialAccountRepository extends JpaRepository<SocialAccount, Long> {

    /**
     * 소셜 로그인의 진입 조회 — 이 결과가 있으면 로그인, 없으면 가입이다.
     * <p>
     * 곧바로 회원 정보(닉네임 등)로 세션을 만들어야 하므로 user를 함께 가져온다.
     */
    @EntityGraph(attributePaths = "user")
    Optional<SocialAccount> findByProviderAndProviderUserId(SocialProvider provider, String providerUserId);
}
