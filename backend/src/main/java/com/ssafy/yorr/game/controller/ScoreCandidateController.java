package com.ssafy.yorr.game.controller;

import com.ssafy.yorr.game.dto.ScoreCandidatesRequest;
import com.ssafy.yorr.game.dto.ScoreCandidatesResponse;
import com.ssafy.yorr.game.service.ScoreCandidateService;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/games/{gameId}/score-candidates")
public class ScoreCandidateController {
    private final ScoreCandidateService scoreCandidateService;

    public ScoreCandidateController(ScoreCandidateService scoreCandidateService) {
        this.scoreCandidateService = scoreCandidateService;
    }

    @PostMapping(
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    public ScoreCandidatesResponse getScoreCandidates(
            @PathVariable String gameId,
            @Valid @RequestBody ScoreCandidatesRequest request
    ) {
        return scoreCandidateService.calculate(request.dice());
    }
}
