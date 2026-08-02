package com.ssafy.yorr.auth.application;

import com.ssafy.yorr.user.domain.SocialAccount;
import com.ssafy.yorr.user.domain.SocialProvider;
import com.ssafy.yorr.user.domain.User;
import com.ssafy.yorr.user.repository.SocialAccountRepository;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SocialLoginServiceTest {

    private static final String PROVIDER_USER_ID = "1234567890";

    private final SocialAccountRepository socialAccounts = mock(SocialAccountRepository.class);
    private final SocialAccountRegistrar registrar = mock(SocialAccountRegistrar.class);
    private final SocialLoginService service = new SocialLoginService(socialAccounts, registrar);

    @Test
    void 이미_연결된_소셜_계정이면_가입하지_않고_그_회원을_돌려준다() {
        User existing = User.create("기존회원", null);
        when(socialAccounts.findByProviderAndProviderUserId(SocialProvider.KAKAO, PROVIDER_USER_ID))
                .thenReturn(Optional.of(SocialAccount.link(existing, SocialProvider.KAKAO, PROVIDER_USER_ID)));

        User result = service.loginOrRegister(SocialProvider.KAKAO, PROVIDER_USER_ID, "카카오닉", null);

        assertThat(result).isSameAs(existing);
        verify(registrar, never()).register(any(), anyString(), anyString(), any());
    }

    /**
     * 동의항목이 꺼진 채로 처음 로그인하면 "플레이어"로 가입된다. 나중에 설정을 켜도 우리가
     * 받아 적지 않으면 그 이름이 영원히 남는다 — 고칠 화면(151)도 아직 없다.
     */
    @Test
    void 임시_이름으로_가입된_회원은_진짜_이름을_받으면_갱신한다() {
        User placeholder = User.create(User.PLACEHOLDER_NICKNAME, null);
        User renamed = User.create("진짜닉네임", null);
        when(socialAccounts.findByProviderAndProviderUserId(SocialProvider.KAKAO, PROVIDER_USER_ID))
                .thenReturn(Optional.of(SocialAccount.link(placeholder, SocialProvider.KAKAO, PROVIDER_USER_ID)));
        when(registrar.adoptProviderProfile(placeholder.getId(), "진짜닉네임", "https://img"))
                .thenReturn(renamed);

        User result = service.loginOrRegister(
                SocialProvider.KAKAO, PROVIDER_USER_ID, "진짜닉네임", "https://img");

        assertThat(result).isSameAs(renamed);
    }

    /** 사용자가 직접 정한 이름을 로그인할 때마다 덮어쓰면 바꿀 방법이 없어진다. */
    @Test
    void 이미_이름이_있는_회원은_로그인해도_덮어쓰지_않는다() {
        User existing = User.create("내가정한이름", null);
        when(socialAccounts.findByProviderAndProviderUserId(SocialProvider.KAKAO, PROVIDER_USER_ID))
                .thenReturn(Optional.of(SocialAccount.link(existing, SocialProvider.KAKAO, PROVIDER_USER_ID)));

        User result = service.loginOrRegister(
                SocialProvider.KAKAO, PROVIDER_USER_ID, "카카오에서온이름", null);

        assertThat(result).isSameAs(existing);
        verify(registrar, never()).adoptProviderProfile(anyString(), anyString(), any());
    }

    @Test
    void 처음_보는_소셜_계정이면_가입시킨다() {
        User created = User.create("카카오닉", "https://img");
        when(socialAccounts.findByProviderAndProviderUserId(SocialProvider.KAKAO, PROVIDER_USER_ID))
                .thenReturn(Optional.empty());
        when(registrar.register(SocialProvider.KAKAO, PROVIDER_USER_ID, "카카오닉", "https://img"))
                .thenReturn(created);

        User result = service.loginOrRegister(SocialProvider.KAKAO, PROVIDER_USER_ID, "카카오닉", "https://img");

        assertThat(result).isSameAs(created);
    }

    /**
     * 로그인 버튼을 두 번 누르면 두 요청이 모두 "없음"을 보고 나란히 가입을 시도한다.
     * 유니크 제약이 한쪽을 막는데, 그 실패는 오류가 아니라 "누가 먼저 가입했다"는 신호다.
     */
    @Test
    void 동시_가입으로_유니크_제약에_걸리면_먼저_가입된_회원을_다시_찾는다() {
        User winner = User.create("먼저가입", null);
        when(socialAccounts.findByProviderAndProviderUserId(SocialProvider.KAKAO, PROVIDER_USER_ID))
                .thenReturn(Optional.empty())
                .thenReturn(Optional.of(SocialAccount.link(winner, SocialProvider.KAKAO, PROVIDER_USER_ID)));
        when(registrar.register(any(), anyString(), anyString(), any()))
                .thenThrow(new DataIntegrityViolationException("duplicate"));

        User result = service.loginOrRegister(SocialProvider.KAKAO, PROVIDER_USER_ID, "카카오닉", null);

        assertThat(result).isSameAs(winner);
    }

    /** 제약 위반인데 다시 찾아도 없다면 경쟁이 아니라 진짜 오류다 — 삼키면 원인을 잃는다. */
    @Test
    void 제약_위반_뒤에도_회원을_찾지_못하면_원래_예외를_그대로_던진다() {
        when(socialAccounts.findByProviderAndProviderUserId(SocialProvider.KAKAO, PROVIDER_USER_ID))
                .thenReturn(Optional.empty());
        DataIntegrityViolationException failure = new DataIntegrityViolationException("nickname too long");
        when(registrar.register(any(), anyString(), anyString(), any())).thenThrow(failure);

        assertThatThrownBy(() -> service.loginOrRegister(SocialProvider.KAKAO, PROVIDER_USER_ID, "카카오닉", null))
                .isSameAs(failure);
    }
}
