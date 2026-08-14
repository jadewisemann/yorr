package com.ssafy.yorr.game.controller;

import com.ssafy.yorr.game.domain.GameResultCalculator;
import com.ssafy.yorr.game.domain.PlayerFinalScore;
import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.exception.GameScoreQueryException;
import com.ssafy.yorr.game.service.GameScoreQueryService;
import com.ssafy.yorr.user.UserIdentity;
import com.ssafy.yorr.user.UserType;
import com.ssafy.yorr.user.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Map;

import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.GAME_NOT_FINISHED;
import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.PLAYER_NOT_IN_ROOM;
import static org.hamcrest.Matchers.aMapWithSize;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class GameScoreQueryControllerTest {

    private GameScoreQueryService service;
    private UserService userService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        service = mock(GameScoreQueryService.class);
        userService = mock(UserService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(
                new GameScoreQueryController(service, userService)
        ).build();
    }

    @Test
    void returnsPlayerKeyedScoreboardsWithNullAndZeroSeparated() throws Exception {
        authenticate();
        when(service.getScoreboards("room-a", "player-a")).thenReturn(Map.of(
                "player-a", new ScoreBoard(Map.of("yacht", 0), 0, 0, 0),
                "player-b", new ScoreBoard(Map.of(), 0, 0, 0)
        ));

        mockMvc.perform(authenticatedGet("/api/v1/rooms/room-a/scores"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.player-a.categories.yacht").value(0))
                .andExpect(jsonPath("$.player-a.categories.ones").value(nullValue()))
                .andExpect(jsonPath("$.player-a.total").value(0))
                .andExpect(jsonPath("$.player-b.categories").value(aMapWithSize(12)))
                .andExpect(jsonPath("$.player-b.categories.ones").value(nullValue()))
                .andExpect(jsonPath("$.player-b.categories.twos").value(nullValue()))
                .andExpect(jsonPath("$.player-b.categories.threes").value(nullValue()))
                .andExpect(jsonPath("$.player-b.categories.fours").value(nullValue()))
                .andExpect(jsonPath("$.player-b.categories.fives").value(nullValue()))
                .andExpect(jsonPath("$.player-b.categories.sixes").value(nullValue()))
                .andExpect(jsonPath("$.player-b.categories.choice").value(nullValue()))
                .andExpect(jsonPath("$.player-b.categories.fourOfAKind").value(nullValue()))
                .andExpect(jsonPath("$.player-b.categories.fullHouse").value(nullValue()))
                .andExpect(jsonPath("$.player-b.categories.smallStraight").value(nullValue()))
                .andExpect(jsonPath("$.player-b.categories.largeStraight").value(nullValue()))
                .andExpect(jsonPath("$.player-b.categories.yacht").value(nullValue()))
                .andExpect(jsonPath("$.player-b.total").value(0));
    }

    @Test
    void returnsRankingsAndTieFlag() throws Exception {
        authenticate();
        when(service.getResults("room-a", "player-a")).thenReturn(
                GameResultCalculator.calculate(java.util.List.of(
                        new PlayerFinalScore("player-b", 200),
                        new PlayerFinalScore("player-a", 200),
                        new PlayerFinalScore("player-c", 100)
                ))
        );

        mockMvc.perform(authenticatedGet("/api/v1/rooms/room-a/results"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rankings[0].rank").value(1))
                .andExpect(jsonPath("$.rankings[0].playerId").value("player-a"))
                .andExpect(jsonPath("$.rankings[0].total").value(200))
                .andExpect(jsonPath("$.rankings[1].rank").value(1))
                .andExpect(jsonPath("$.rankings[2].rank").value(3))
                .andExpect(jsonPath("$.isTie").value(true));
    }

    @Test
    void rejectsMissingAuthentication() throws Exception {
        when(userService.authenticate(null, null))
                .thenThrow(new IllegalArgumentException("invalid_guest_session"));

        mockMvc.perform(get("/api/v1/rooms/room-a/scores"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_FAILED"));

        verifyNoInteractions(service);
    }

    @Test
    void rejectsNonParticipant() throws Exception {
        authenticate();
        when(service.getScoreboards("room-a", "player-a"))
                .thenThrow(new GameScoreQueryException(
                        PLAYER_NOT_IN_ROOM,
                        "방 참가자가 아닙니다: player-a"
                ));

        mockMvc.perform(authenticatedGet("/api/v1/rooms/room-a/scores"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_IN_ROOM"));
    }

    @Test
    void rejectsResultsBeforeGameFinishes() throws Exception {
        authenticate();
        when(service.getResults("room-a", "player-a"))
                .thenThrow(new GameScoreQueryException(
                        GAME_NOT_FINISHED,
                        "아직 종료되지 않은 게임입니다: room-a"
                ));

        mockMvc.perform(authenticatedGet("/api/v1/rooms/room-a/results"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("GAME_NOT_FINISHED"));
    }

    private void authenticate() {
        when(userService.authenticate("player-a", "Bearer token-a"))
                .thenReturn(new UserIdentity("player-a", "A", UserType.GUEST));
    }

    private static org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder authenticatedGet(
            String url
    ) {
        return get(url)
                .header("X-User-Id", "player-a")
                .header("Authorization", "Bearer token-a");
    }
}
