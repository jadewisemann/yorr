package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.round.application.RoundStartedEvent;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.application.RoundTimerService;
import com.ssafy.yorr.game.round.application.ScoreRoundSubmissionService;
import com.ssafy.yorr.game.round.infrastructure.InMemoryRoundStateStore;
import com.ssafy.yorr.game.repository.ScoreBoardStore;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import com.ssafy.yorr.room.dto.ParticipantKind;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomPlayerSnapshot;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.RoomBroadcaster;
import org.junit.jupiter.api.Test;

import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class YachtBotGameCompletionTest {

    @Test
    void twoLocalBotsCompleteAllTwelveRoundsThroughTheSharedActionPath() {
        InMemoryRoundStateStore stateStore = new InMemoryRoundStateStore();
        RoundSynchronizationService rounds = new RoundSynchronizationService(stateStore);
        RoundTimerService timers = mock(RoundTimerService.class);
        RoomBroadcaster broadcaster = mock(RoomBroadcaster.class);
        RoomService rooms = mock(RoomService.class);
        InMemoryScoreBoardStore scoreStore = new InMemoryScoreBoardStore();
        ScoreConfirmationService scores = new ScoreConfirmationService(scoreStore);
        ScoreRoundSubmissionService submissions =
                new ScoreRoundSubmissionService(rounds, scores, rooms);
        YachtTurnActionService actions =
                new YachtTurnActionService(rounds, timers, broadcaster, submissions);
        YachtBotTurnCoordinator coordinator = new YachtBotTurnCoordinator(
                rounds,
                actions,
                new LocalYachtBotStrategy(),
                rooms,
                scores
        );
        when(rooms.getSnapshot("room-a")).thenReturn(botRoom());
        rounds.initialize("room-a", 1, List.of("bot-easy", "bot-hard"));

        int actionsExecuted = 0;
        while (rounds.findByRoomId("room-a").orElseThrow().isFinished() == false
                && actionsExecuted < 200) {
            var state = rounds.findByRoomId("room-a").orElseThrow();
            assertThat(coordinator.playIfCurrent(new RoundStartedEvent("room-a", state)))
                    .isTrue();
            actionsExecuted++;
        }

        var finished = rounds.findByRoomId("room-a").orElseThrow();
        assertThat(finished.isFinished()).isTrue();
        assertThat(finished.roundNumber()).isEqualTo(12);
        assertThat(actionsExecuted).isBetween(96, 144);
        assertThat(scoreStore.findScoreBoard("game-a", "bot-easy").categories())
                .doesNotContainValue(null);
        assertThat(scoreStore.findScoreBoard("game-a", "bot-hard").categories())
                .doesNotContainValue(null);
    }

    private static RoomSnapshot botRoom() {
        return new RoomSnapshot(
                "room-a",
                YachtDiceGameModule.CODE,
                "game-a",
                "bot-easy",
                RoomPhase.PLAYING,
                6,
                List.of(
                        new RoomPlayerSnapshot(
                                "bot-easy",
                                "Easy Bot",
                                0,
                                ParticipantKind.BOT
                        ),
                        new RoomPlayerSnapshot(
                                "bot-hard",
                                "Hard Bot",
                                0,
                                ParticipantKind.BOT
                        )
                )
        );
    }

    private static final class InMemoryScoreBoardStore implements ScoreBoardStore {

        private final Map<String, Map<ScoreCategory, Integer>> scores = new HashMap<>();

        @Override
        public ScoreBoard confirmScore(
                String gameId,
                String playerId,
                int roundNumber,
                ScoreCategory category,
                int score,
                String requestSignature
        ) {
            Map<ScoreCategory, Integer> playerScores =
                    scores.computeIfAbsent(playerId, ignored -> new EnumMap<>(ScoreCategory.class));
            if (playerScores.putIfAbsent(category, score) != null) {
                throw new IllegalStateException("category already used: " + category);
            }
            return scoreboard(playerScores);
        }

        @Override
        public ScoreBoard findScoreBoard(String gameId, String playerId) {
            return scoreboard(scores.getOrDefault(playerId, Map.of()));
        }

        private static ScoreBoard scoreboard(Map<ScoreCategory, Integer> scores) {
            int upperSubtotal = scores.entrySet().stream()
                    .filter(entry -> entry.getKey().isUpperCategory())
                    .mapToInt(Map.Entry::getValue)
                    .sum();
            int upperBonus = upperSubtotal >= 63 ? 35 : 0;
            int total = scores.values().stream().mapToInt(Integer::intValue).sum() + upperBonus;
            Map<String, Integer> categories = new HashMap<>();
            scores.forEach((category, score) -> categories.put(category.apiKey(), score));
            return new ScoreBoard(categories, upperSubtotal, upperBonus, total);
        }
    }
}
