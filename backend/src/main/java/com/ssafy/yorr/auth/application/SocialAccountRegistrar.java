package com.ssafy.yorr.auth.application;

import com.ssafy.yorr.user.domain.SocialAccount;
import com.ssafy.yorr.user.domain.SocialProvider;
import com.ssafy.yorr.user.domain.User;
import com.ssafy.yorr.user.repository.SocialAccountRepository;
import com.ssafy.yorr.user.repository.UserRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 신규 가입만 담당한다. 회원과 소셜 연결이 <b>한 트랜잭션</b>에서 함께 만들어져야
 * 소셜 계정 없는 유령 회원이 남지 않는다.
 * <p>
 * {@link SocialLoginService}와 별도 빈으로 둔 이유: 유니크 제약 위반을 잡아 다시 조회하려면
 * 그 트랜잭션이 <b>먼저 롤백되어 있어야</b> 한다. 같은 클래스 안에서 호출하면 프록시를
 * 지나지 않아 트랜잭션 경계가 생기지 않는다.
 */
@Component
public class SocialAccountRegistrar {

    private final UserRepository users;
    private final SocialAccountRepository socialAccounts;

    public SocialAccountRegistrar(UserRepository users, SocialAccountRepository socialAccounts) {
        this.users = users;
        this.socialAccounts = socialAccounts;
    }

    @Transactional
    public User register(SocialProvider provider, String providerUserId, String nickname, String profileImageUrl) {
        User user = users.save(User.create(nickname, profileImageUrl));
        socialAccounts.save(SocialAccount.link(user, provider, providerUserId));
        return user;
    }
}
