package com.ssafy.yorr.user.application;

import com.ssafy.yorr.user.domain.User;
import com.ssafy.yorr.user.repository.UserRepository;
import com.ssafy.yorr.user.service.UserService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 회원이 자기 프로필을 보고 고치는 경로.
 * <p>
 * 닉네임을 바꾸면 <b>두 곳</b>을 함께 갱신한다 — users 테이블(영구)과 Redis 세션(인증·표시).
 * DB만 고치면 다시 로그인하기 전까지 화면에 옛 이름이 남고, 세션만 고치면 만료되는 순간
 * 되돌아간다.
 * <p>
 * 지난 판의 기록은 건드리지 않는다. {@code match_participants.display_nickname}은 그때
 * 화면에 보였던 이름이라, 이름을 바꿨다고 과거 전적의 이름까지 바뀌면 안 된다.
 */
@Service
public class UserProfileService {

    private final UserRepository users;
    private final UserService userService;

    public UserProfileService(UserRepository users, UserService userService) {
        this.users = users;
        this.userService = userService;
    }

    @Transactional(readOnly = true)
    public User read(String userId) {
        return users.findById(userId).orElseThrow(() -> new IllegalArgumentException("user_not_found"));
    }

    /**
     * @param nickname 새 닉네임. 게스트 생성과 같은 규칙으로 다듬는다(빈 값·20자 초과는 거절).
     * @return 갱신된 회원
     */
    @Transactional
    public User rename(String userId, String nickname) {
        String normalized = UserService.normalizeNickname(nickname);
        User user = read(userId);
        user.rename(normalized);
        userService.renameSession(userId, normalized);
        return user;
    }
}
