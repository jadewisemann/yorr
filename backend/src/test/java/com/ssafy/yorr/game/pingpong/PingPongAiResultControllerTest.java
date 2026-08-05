package com.ssafy.yorr.game.pingpong;

import com.ssafy.yorr.user.SessionAuthenticationException;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class PingPongAiResultControllerTest {

    private PingPongAiResultService results;
    private UserService users;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        results = mock(PingPongAiResultService.class);
        users = mock(UserService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new PingPongAiResultController(results, users)).build();
    }

    @Test
    void 로그인_회원의_결과를_저장한다() throws Exception {
        UserIdentity member = new UserIdentity("member-1", "회원", UserType.MEMBER);
        when(users.authenticateSession("token-1")).thenReturn(member);

        mockMvc.perform(request().header("Authorization", "Bearer token-1"))
                .andExpect(status().isNoContent());

        verify(results).archive(any(UserIdentity.class), any(PingPongAiResultRequest.class));
    }

    @Test
    void 비로그인_게스트의_결과를_저장한다() throws Exception {
        mockMvc.perform(request()).andExpect(status().isNoContent());

        verify(results).archiveGuest(any(PingPongAiResultRequest.class));
        verifyNoInteractions(users);
    }

    @Test
    void 기존_게스트_세션도_해당_UUID로_결과를_저장한다() throws Exception {
        when(users.authenticateSession("guest-token"))
                .thenReturn(new UserIdentity("guest-1", "손님", UserType.GUEST));

        mockMvc.perform(request().header("Authorization", "Bearer guest-token"))
                .andExpect(status().isNoContent());
        verify(results).archive(any(UserIdentity.class), any(PingPongAiResultRequest.class));
    }

    @Test
    void 잘못된_인증_헤더는_거절한다() throws Exception {
        mockMvc.perform(request().header("Authorization", "invalid"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(results, users);
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request() {
        return post("/api/v1/games/ping-pong/ai-results")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"resultId":"4b72f136-f3c2-49c9-bfdb-290891fd8638","humanScore":11,"aiScore":7}
                        """);
    }
}
