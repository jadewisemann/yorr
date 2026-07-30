package com.ssafy.yorr.game.service;

import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.domain.YachtScoreCalculator;
import com.ssafy.yorr.game.dto.ScoreCandidatesResponse;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class ScoreCandidateService {

    public ScoreCandidatesResponse calculate(List<Integer> dice) {
        int[] diceValues = dice.stream()
                .mapToInt(Integer::intValue)
                .toArray();
        Map<String, Integer> candidates = new LinkedHashMap<>();

        for (ScoreCategory category : ScoreCategory.values()) {
            candidates.put(toApiKey(category), YachtScoreCalculator.calculateScore(category, diceValues));
        }

        return new ScoreCandidatesResponse(candidates);
    }

    private static String toApiKey(ScoreCategory category) {
        return switch (category) {
            case ACES -> "ones";
            case DEUCES -> "twos";
            case THREES -> "threes";
            case FOURS -> "fours";
            case FIVES -> "fives";
            case SIXES -> "sixes";
            case CHOICE -> "choice";
            case FOUR_OF_A_KIND -> "fourOfAKind";
            case FULL_HOUSE -> "fullHouse";
            case SMALL_STRAIGHT -> "smallStraight";
            case LARGE_STRAIGHT -> "largeStraight";
            case YACHT -> "yacht";
        };
    }
}
