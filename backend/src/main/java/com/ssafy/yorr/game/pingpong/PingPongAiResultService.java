package com.ssafy.yorr.game.pingpong;

import com.ssafy.yorr.game.match.application.MatchArchiveService;
import com.ssafy.yorr.game.match.application.MatchArchiveService.ParticipantResult;
import com.ssafy.yorr.user.UserIdentity;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
public class PingPongAiResultService {

    static final String LOCAL_AI_ROOM_CODE = "LOCAL_AI";
    static final String AI_PLAYER_ID = "ping-pong-ai";
    static final String AI_NICKNAME = "AI";
    static final String GUEST_NICKNAME = "게스트";

    private final MatchArchiveService matches;

    public PingPongAiResultService(MatchArchiveService matches) {
        this.matches = matches;
    }

    public boolean archive(UserIdentity user, PingPongAiResultRequest request) {
        if (user == null || request == null) throw new IllegalArgumentException("invalid_ai_result");
        return archive(user.userId(), user.nickname(), request);
    }

    public boolean archiveGuest(PingPongAiResultRequest request) {
        if (request == null) throw new IllegalArgumentException("invalid_ai_result");
        return archive(UUID.randomUUID().toString(), GUEST_NICKNAME, request);
    }

    private boolean archive(String playerId, String nickname, PingPongAiResultRequest request) {
        String resultId = normalizeResultId(request.resultId());
        validateFinalScore(request.humanScore(), request.aiScore());

        int humanRank = request.humanScore() > request.aiScore() ? 1 : 2;
        int aiRank = humanRank == 1 ? 2 : 1;
        return matches.archive(
                resultId,
                PingPongGameModule.CODE,
                LOCAL_AI_ROOM_CODE,
                List.of(
                        new ParticipantResult(playerId, nickname, request.humanScore(), humanRank),
                        new ParticipantResult(AI_PLAYER_ID, AI_NICKNAME, request.aiScore(), aiRank)
                )
        );
    }

    private static String normalizeResultId(String resultId) {
        try {
            return UUID.fromString(resultId).toString();
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("invalid_result_id");
        }
    }

    private static void validateFinalScore(int humanScore, int aiScore) {
        int winner = Math.max(humanScore, aiScore);
        if (humanScore < 0 || aiScore < 0
                || winner < PingPongRules.WIN_SCORE
                || Math.abs(humanScore - aiScore) < 2) {
            throw new IllegalArgumentException("invalid_final_score");
        }
    }
}
