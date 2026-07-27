package com.ssafy.yorr.game.service;

import com.ssafy.yorr.game.domain.GameResult;
import com.ssafy.yorr.game.domain.GameResultCalculator;
import com.ssafy.yorr.game.domain.GameScoreSnapshot;
import com.ssafy.yorr.game.domain.PlayerFinalScore;
import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.exception.GameScoreQueryException;
import com.ssafy.yorr.game.repository.GameScoreQueryStore;
import com.ssafy.yorr.room.dto.RoomPhase;
import org.springframework.stereotype.Service;

import java.util.Map;

import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.GAME_NOT_FINISHED;
import static com.ssafy.yorr.game.exception.GameScoreQueryException.Reason.GAME_NOT_STARTED;

@Service
public class GameScoreQueryService {

    private final GameScoreQueryStore gameScoreQueryStore;

    public GameScoreQueryService(GameScoreQueryStore gameScoreQueryStore) {
        this.gameScoreQueryStore = gameScoreQueryStore;
    }

    public Map<String, ScoreBoard> getScoreboards(String roomId, String requesterId) {
        GameScoreSnapshot snapshot = gameScoreQueryStore.findByRoomId(roomId, requesterId);
        if (snapshot.phase() != RoomPhase.PLAYING && snapshot.phase() != RoomPhase.FINISHED) {
            throw new GameScoreQueryException(
                    GAME_NOT_STARTED,
                    "진행 중인 게임이 없습니다: " + roomId
            );
        }
        return snapshot.scoreboards();
    }

    public GameResult getResults(String roomId, String requesterId) {
        GameScoreSnapshot snapshot = gameScoreQueryStore.findByRoomId(roomId, requesterId);
        if (snapshot.phase() != RoomPhase.FINISHED) {
            throw new GameScoreQueryException(
                    GAME_NOT_FINISHED,
                    "아직 종료되지 않은 게임입니다: " + roomId
            );
        }
        return GameResultCalculator.calculate(
                snapshot.scoreboards().entrySet().stream()
                        .map(entry -> new PlayerFinalScore(entry.getKey(), entry.getValue().total()))
                        .toList()
        );
    }
}
