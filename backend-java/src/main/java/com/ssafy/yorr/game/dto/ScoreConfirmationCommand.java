package com.ssafy.yorr.game.dto;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public record ScoreConfirmationCommand(
        String gameId,
        String playerId,
        int roundNumber,
        String category,
        List<Integer> dice
) {

    public ScoreConfirmationCommand {
        if (gameId == null || gameId.isBlank()) {
            throw new IllegalArgumentException("gameId는 비어 있을 수 없습니다.");
        }
        if (playerId == null || playerId.isBlank()) {
            throw new IllegalArgumentException("playerId는 비어 있을 수 없습니다.");
        }
        if (roundNumber < 1) {
            throw new IllegalArgumentException("roundNumber는 1 이상이어야 합니다.");
        }
        if (category == null || category.isBlank()) {
            throw new IllegalArgumentException("category는 비어 있을 수 없습니다.");
        }
        dice = dice == null
                ? null
                : Collections.unmodifiableList(new ArrayList<>(dice));
    }
}
