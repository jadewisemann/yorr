package com.ssafy.yorr.ws.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.ssafy.yorr.game.domain.ScoreBoard;

import java.util.List;
import java.util.Map;

/**
 * 재접속 시 클라이언트가 진행 화면을 복원하는 데 필요한 권위 상태.
 * 프론트 SSOT의 GameState 중 진행 중 게임에 필요한 필드를 미러링한다.
 * <p>
 * 현재 턴의 굴림 진행({@code rollCount} · {@code dice} · {@code held})까지 실어야 한다.
 * 이게 없으면 재접속한 클라이언트는 굴림 0회부터 다시 세고, 그 다음 dice.roll이
 * 서버의 activeRollCount와 어긋나 INVALID_ROLL로 거부된다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record GameState(
        int roundNumber,
        String activePlayerId,
        long roundDeadline,
        Map<String, ScoreBoard> scores,
        List<String> turnOrder,
        /** 현재 턴에서 서버가 확정한 굴림 횟수. 첫 굴림 전에는 0. */
        int rollCount,
        /** 현재 턴에 놓여 있는 주사위. 첫 굴림 전에는 null이라 직렬화에서 빠진다. */
        List<Integer> dice,
        /** 턴 주인이 유지 중인 KEEP. 첫 굴림 전에는 null이라 직렬화에서 빠진다. */
        List<Boolean> held
) {
    public GameState {
        scores = scores == null ? Map.of() : Map.copyOf(scores);
        turnOrder = turnOrder == null ? List.of() : List.copyOf(turnOrder);
        // dice·held는 빈 배열과 "아직 안 굴림"을 구분해야 하므로 null을 그대로 둔다.
        dice = dice == null ? null : List.copyOf(dice);
        held = held == null ? null : List.copyOf(held);
    }
}
