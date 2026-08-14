package com.ssafy.yorr.game.yacht;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.ssafy.yorr.game.domain.ScoreBoard;

import java.util.List;
import java.util.Map;

/**
 * 재접속 시 클라이언트가 진행 화면을 복원하는 데 필요한 권위 상태.
 * 프론트 SSOT의 GameState 중 진행 중 게임에 필요한 필드를 미러링한다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record YachtDiceState(
        int roundNumber,
        String activePlayerId,
        long roundDeadline,
        Map<String, ScoreBoard> scores,
        List<String> turnOrder,
        int rollCount,
        List<Integer> dice,
        List<Boolean> held
) {
    public YachtDiceState {
        scores = scores == null ? Map.of() : Map.copyOf(scores);
        turnOrder = turnOrder == null ? List.of() : List.copyOf(turnOrder);
    }
}
