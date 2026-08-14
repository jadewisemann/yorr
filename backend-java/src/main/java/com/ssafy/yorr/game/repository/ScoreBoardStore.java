package com.ssafy.yorr.game.repository;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;

public interface ScoreBoardStore {

    ScoreBoard confirmScore(
            String gameId,
            String playerId,
            int roundNumber,
            ScoreCategory category,
            int score,
            String requestSignature
    );

    /** 확정된 점수만 담긴 현재 점수판. 아직 기록하지 않은 족보는 값이 null이다. */
    ScoreBoard findScoreBoard(String gameId, String playerId);
}
