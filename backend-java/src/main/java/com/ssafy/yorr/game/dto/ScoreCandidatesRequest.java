package com.ssafy.yorr.game.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record ScoreCandidatesRequest(
        @NotNull
        @Size(min = 5, max = 5)
        List<@NotNull @Min(1) @Max(6) Integer> dice
) {
}
