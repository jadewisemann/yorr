package com.ssafy.yorr.game.domain;

import java.util.List;

public record GameResult(List<PlayerResult> players, boolean isTie) {

    public GameResult {
        if (players == null) {
            throw new IllegalArgumentException("플레이어 결과는 null일 수 없습니다.");
        }
        players = List.copyOf(players);
    }
}
