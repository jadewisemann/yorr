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
}
