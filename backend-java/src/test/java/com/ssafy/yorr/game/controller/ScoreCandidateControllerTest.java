package com.ssafy.yorr.game.controller;

import com.ssafy.yorr.game.service.ScoreCandidateService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ScoreCandidateController.class)
@Import(ScoreCandidateService.class)
class ScoreCandidateControllerTest {
    private static final String URL = "/api/v1/games/game-1/score-candidates";

    @Autowired
    private MockMvc mockMvc;

    @Test
    void returnsAllLowerCamelCaseCandidates() throws Exception {
        mockMvc.perform(post(URL)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"dice":[3,3,3,5,5]}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.candidates.ones").value(0))
                .andExpect(jsonPath("$.candidates.twos").value(0))
                .andExpect(jsonPath("$.candidates.threes").value(9))
                .andExpect(jsonPath("$.candidates.fours").value(0))
                .andExpect(jsonPath("$.candidates.fives").value(10))
                .andExpect(jsonPath("$.candidates.sixes").value(0))
                .andExpect(jsonPath("$.candidates.choice").value(19))
                .andExpect(jsonPath("$.candidates.fourOfAKind").value(0))
                .andExpect(jsonPath("$.candidates.fullHouse").value(19))
                .andExpect(jsonPath("$.candidates.smallStraight").value(0))
                .andExpect(jsonPath("$.candidates.largeStraight").value(0))
                .andExpect(jsonPath("$.candidates.yacht").value(0))
                .andExpect(jsonPath("$.candidates.FOUR_OF_A_KIND").doesNotExist());
    }

    @Test
    void rejectsMissingDice() throws Exception {
        assertBadRequest("{}");
    }

    @Test
    void rejectsNullDice() throws Exception {
        assertBadRequest("{\"dice\":null}");
    }

    @Test
    void rejectsFourDice() throws Exception {
        assertBadRequest("{\"dice\":[1,2,3,4]}");
    }

    @Test
    void rejectsSixDice() throws Exception {
        assertBadRequest("{\"dice\":[1,2,3,4,5,6]}");
    }

    @Test
    void rejectsZeroFace() throws Exception {
        assertBadRequest("{\"dice\":[0,1,2,3,4]}");
    }

    @Test
    void rejectsSevenFace() throws Exception {
        assertBadRequest("{\"dice\":[1,2,3,4,7]}");
    }

    @Test
    void rejectsNullDie() throws Exception {
        assertBadRequest("{\"dice\":[1,2,null,4,5]}");
    }

    @Test
    void rejectsMalformedJson() throws Exception {
        assertBadRequest("{\"dice\":[1,2,3,4,5]");
    }

    private void assertBadRequest(String body) throws Exception {
        mockMvc.perform(post(URL)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }
}
