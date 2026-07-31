package com.ssafy.yorr.auth.application;

import com.ssafy.yorr.user.domain.SocialAccount;
import com.ssafy.yorr.user.domain.SocialProvider;
import com.ssafy.yorr.user.domain.User;
import com.ssafy.yorr.user.repository.SocialAccountRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.util.Optional;

/**
 * "있으면 로그인, 없으면 가입"을 정하는 한 곳.
 * <p>
 * 이 분기는 동시 요청에서 깨진다 — 같은 사람이 로그인 버튼을 두 번 누르면 두 요청이 모두
 * "없음"을 보고 나란히 가입을 시도한다. 최종 방어선은 {@code (provider, provider_user_id)}
 * 유니크 제약이고, 여기서는 그 위반을 <b>실패가 아니라 "누군가 방금 먼저 가입했다"는 신호로</b>
 * 받아 다시 조회한다.
 */
@Service
public class SocialLoginService {

    private final SocialAccountRepository socialAccounts;
    private final SocialAccountRegistrar registrar;

    public SocialLoginService(SocialAccountRepository socialAccounts, SocialAccountRegistrar registrar) {
        this.socialAccounts = socialAccounts;
        this.registrar = registrar;
    }

    public User loginOrRegister(SocialProvider provider, String providerUserId,
                                String nickname, String profileImageUrl) {
        return find(provider, providerUserId)
                .orElseGet(() -> registerOrRecover(provider, providerUserId, nickname, profileImageUrl));
    }

    private User registerOrRecover(SocialProvider provider, String providerUserId,
                                   String nickname, String profileImageUrl) {
        try {
            return registrar.register(provider, providerUserId, nickname, profileImageUrl);
        } catch (DataIntegrityViolationException race) {
            // 경쟁 요청이 한발 먼저 가입시켰다. 그 트랜잭션은 롤백됐으니 다시 조회하면 있다.
            return find(provider, providerUserId).orElseThrow(() -> race);
        }
    }

    private Optional<User> find(SocialProvider provider, String providerUserId) {
        return socialAccounts.findByProviderAndProviderUserId(provider, providerUserId)
                .map(SocialAccount::getUser);
    }
}
