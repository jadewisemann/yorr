package com.ssafy.yorr.game.pingpong;

import com.ssafy.yorr.game.match.application.MatchArchiveService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class PingPongAiResultServiceTest {

    private final PingPongAiResultService service =
            new PingPongAiResultService(mock(MatchArchiveService.class));
    private final UserIdentity member = new UserIdentity("member-1", "회원", UserType.MEMBER);

    @Test
    void 정상적으로_끝날_수_없는_점수는_거절한다() {
        assertInvalidScore(10, 7);
        assertInvalidScore(11, 10);
        assertInvalidScore(-1, 11);
    }

    @Test
    void 결과_ID는_UUID여야_한다() {
        assertThatThrownBy(() -> service.archive(
                member, new PingPongAiResultRequest("not-a-uuid", 11, 7)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("invalid_result_id");
    }

    private void assertInvalidScore(int humanScore, int aiScore) {
        assertThatThrownBy(() -> service.archive(
                member,
                new PingPongAiResultRequest(
                        "e848355a-78a1-4297-a492-754a124c6b16", humanScore, aiScore)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("invalid_final_score");
    }
}
