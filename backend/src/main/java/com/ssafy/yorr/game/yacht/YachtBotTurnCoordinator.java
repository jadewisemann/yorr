package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.round.application.RoundStartedEvent;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import com.ssafy.yorr.room.dto.BotDifficulty;
import com.ssafy.yorr.room.dto.ParticipantKind;
import com.ssafy.yorr.room.dto.RoomPlayerSnapshot;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.dto.DiceHoldPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class YachtBotTurnCoordinator {

    private static final List<Boolean> NO_HELD =
            List.of(false, false, false, false, false);

    private final RoundSynchronizationService rounds;
    private final YachtTurnActionService actions;
    private final LocalYachtBotStrategy strategy;
    private final RoomService rooms;
    private final ScoreConfirmationService scores;

    public YachtBotTurnCoordinator(
            RoundSynchronizationService rounds,
            YachtTurnActionService actions,
            LocalYachtBotStrategy strategy,
            RoomService rooms,
            ScoreConfirmationService scores
    ) {
        this.rounds = rounds;
        this.actions = actions;
        this.strategy = strategy;
        this.rooms = rooms;
        this.scores = scores;
    }

    public boolean playIfCurrent(RoundStartedEvent event) {
        RoundState state = rounds.findByRoomId(event.roomId()).orElse(null);
        if (state == null || state.isFinished() || !TurnVersion.from(event.state()).matches(state)) {
            return false;
        }

        RoomSnapshot room = rooms.getSnapshot(event.roomId());
        RoomPlayerSnapshot bot = findActiveBot(room, state.activePlayerId());
        if (bot == null) {
            return false;
        }

        BotDifficulty difficulty = bot.difficulty() == null
                ? BotDifficulty.NORMAL
                : bot.difficulty();
        if (state.activeRollCount() == 0) {
            actions.roll(
                    event.roomId(),
                    bot.playerId(),
                    new DiceRollPayload(state.roundNumber(), 1, NO_HELD),
                    null
            );
            return true;
        }

        List<ScoreCategory> openCategories =
                scores.openCategories(room.gameId(), bot.playerId());
        if (state.activeRollCount() < RoundState.MAX_ROLL_COUNT) {
            List<Boolean> held = strategy.chooseHeld(difficulty, state.activeDice());
            if (!held.equals(state.activeHeld())) {
                actions.hold(
                        event.roomId(),
                        bot.playerId(),
                        new DiceHoldPayload(state.roundNumber(), held),
                        null
                );
            }
            RoundState current = rounds.findByRoomId(event.roomId()).orElse(null);
            if (!sameTurn(state, current)) {
                return false;
            }
            actions.roll(
                    event.roomId(),
                    bot.playerId(),
                    new DiceRollPayload(
                            current.roundNumber(),
                            current.activeRollCount() + 1,
                            held
                    ),
                    null
            );
            return true;
        }

        ScoreCategory category =
                strategy.chooseCategory(difficulty, state.activeDice(), openCategories);
        actions.submitScore(
                event.roomId(),
                bot.playerId(),
                new RoundSubmitPayload(
                        state.roundNumber(),
                        state.activeDice(),
                        category.apiKey()
                ),
                null
        );
        return true;
    }

    private static RoomPlayerSnapshot findActiveBot(RoomSnapshot room, String activePlayerId) {
        if (room == null || room.gameId() == null || room.gameId().isBlank()) {
            return null;
        }
        return room.players().stream()
                .filter(player -> player.playerId().equals(activePlayerId))
                .filter(player -> player.kind() == ParticipantKind.BOT)
                .findFirst()
                .orElse(null);
    }

    private static boolean sameTurn(RoundState before, RoundState current) {
        return current != null
                && !current.isFinished()
                && current.roundNumber() == before.roundNumber()
                && current.activePlayerId().equals(before.activePlayerId())
                && current.activeRollCount() == before.activeRollCount();
    }

    private record TurnVersion(
            int roundNumber,
            String activePlayerId,
            int activeRollCount,
            List<Integer> dice,
            List<Boolean> held
    ) {
        static TurnVersion from(RoundState state) {
            return new TurnVersion(
                    state.roundNumber(),
                    state.activePlayerId(),
                    state.activeRollCount(),
                    state.activeDice(),
                    state.activeHeld()
            );
        }

        boolean matches(RoundState state) {
            return roundNumber == state.roundNumber()
                    && activePlayerId.equals(state.activePlayerId())
                    && activeRollCount == state.activeRollCount()
                    && java.util.Objects.equals(dice, state.activeDice())
                    && java.util.Objects.equals(held, state.activeHeld());
        }
    }
}
