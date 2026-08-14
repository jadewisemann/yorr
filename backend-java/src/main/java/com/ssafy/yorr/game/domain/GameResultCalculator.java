package com.ssafy.yorr.game.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class GameResultCalculator {
    private static final Comparator<PlayerFinalScore> RESULT_ORDER =
            Comparator.comparingInt(PlayerFinalScore::finalScore)
                    .reversed()
                    .thenComparing(PlayerFinalScore::playerId);

    private GameResultCalculator() {
    }

    public static GameResult calculate(List<PlayerFinalScore> playerScores) {
        validate(playerScores);

        List<PlayerFinalScore> sortedScores = playerScores.stream()
                .sorted(RESULT_ORDER)
                .toList();
        Map<Integer, Long> scoreCounts = countScores(sortedScores);
        List<PlayerResult> playerResults = createPlayerResults(sortedScores, scoreCounts);
        boolean isTie = scoreCounts.get(sortedScores.getFirst().finalScore()) > 1;

        return new GameResult(playerResults, isTie);
    }

    private static void validate(List<PlayerFinalScore> playerScores) {
        if (playerScores == null) {
            throw new IllegalArgumentException("플레이어 최종 점수 목록은 null일 수 없습니다.");
        }
        if (playerScores.isEmpty()) {
            throw new IllegalArgumentException("플레이어 최종 점수 목록은 비어 있을 수 없습니다.");
        }

        Set<String> playerIds = new HashSet<>();
        for (PlayerFinalScore playerScore : playerScores) {
            validatePlayerScore(playerScore);
            if (!playerIds.add(playerScore.playerId())) {
                throw new IllegalArgumentException("중복된 플레이어 식별자는 허용되지 않습니다.");
            }
        }
    }

    private static void validatePlayerScore(PlayerFinalScore playerScore) {
        if (playerScore == null) {
            throw new IllegalArgumentException("플레이어 최종 점수는 null일 수 없습니다.");
        }
        if (playerScore.playerId() == null || playerScore.playerId().isBlank()) {
            throw new IllegalArgumentException("플레이어 식별자는 비어 있을 수 없습니다.");
        }
        if (playerScore.finalScore() == null || playerScore.finalScore() < 0) {
            throw new IllegalArgumentException("최종 점수는 0 이상이어야 합니다.");
        }
    }

    private static Map<Integer, Long> countScores(List<PlayerFinalScore> sortedScores) {
        Map<Integer, Long> scoreCounts = new HashMap<>();
        for (PlayerFinalScore playerScore : sortedScores) {
            scoreCounts.merge(playerScore.finalScore(), 1L, Long::sum);
        }
        return scoreCounts;
    }

    private static List<PlayerResult> createPlayerResults(
            List<PlayerFinalScore> sortedScores,
            Map<Integer, Long> scoreCounts
    ) {
        List<PlayerResult> results = new ArrayList<>(sortedScores.size());
        int rank = 1;
        Integer previousScore = null;

        for (int index = 0; index < sortedScores.size(); index++) {
            PlayerFinalScore playerScore = sortedScores.get(index);
            if (previousScore != null && !previousScore.equals(playerScore.finalScore())) {
                rank = index + 1;
            }

            results.add(new PlayerResult(
                    playerScore.playerId(),
                    playerScore.finalScore(),
                    rank,
                    rank == 1,
                    scoreCounts.get(playerScore.finalScore()) > 1
            ));
            previousScore = playerScore.finalScore();
        }
        return results;
    }
}
