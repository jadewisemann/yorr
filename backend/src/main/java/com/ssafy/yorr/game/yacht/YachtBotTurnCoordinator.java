package com.ssafy.yorr.game.yacht;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.round.application.RoundStartedEvent;
import com.ssafy.yorr.game.round.application.RoundSynchronizationService;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import com.ssafy.yorr.room.dto.ParticipantKind;
import com.ssafy.yorr.room.dto.RoomPlayerSnapshot;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.dto.DiceHoldPayload;
import com.ssafy.yorr.ws.dto.DiceRollPayload;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class YachtBotTurnCoordinator {

    private static final Logger log = LoggerFactory.getLogger(YachtBotTurnCoordinator.class);
    private static final List<Boolean> NO_HELD =
            List.of(false, false, false, false, false);

    private final RoundSynchronizationService rounds;
    private final YachtTurnActionService actions;
    private final ExpectimaxYachtBotPolicy policy;
    private final LocalYachtBotStrategy strategy;
    private final RoomService rooms;
    private final ScoreConfirmationService scores;

    public YachtBotTurnCoordinator(
            RoundSynchronizationService rounds,
            YachtTurnActionService actions,
            ExpectimaxYachtBotPolicy policy,
            LocalYachtBotStrategy strategy,
            RoomService rooms,
            ScoreConfirmationService scores
    ) {
        this.rounds = rounds;
        this.actions = actions;
        this.policy = policy;
        this.strategy = strategy;
        this.rooms = rooms;
        this.scores = scores;
    }

    public boolean playIfCurrent(RoundStartedEvent event) {
        return executeIfCurrent(event).acted();
    }

    BotTurnStep executeIfCurrent(RoundStartedEvent event) {
        RoundState state = rounds.findByRoomId(event.roomId()).orElse(null);
        if (state == null || state.isFinished() || !TurnVersion.from(event.state()).matches(state)) {
            return BotTurnStep.ignored();
        }

        RoomSnapshot room = rooms.getSnapshot(event.roomId());
        RoomPlayerSnapshot bot = findActiveBot(room, state.activePlayerId());
        if (bot == null) {
            return BotTurnStep.ignored();
        }

        if (state.activeRollCount() == 0) {
            RoundState rolled = actions.roll(
                    event.roomId(),
                    bot.playerId(),
                    new DiceRollPayload(state.roundNumber(), 1, NO_HELD),
                    null
            );
            return BotTurnStep.completed(rolled);
        }

        ScoreBoard board = scores.scoreBoard(room.gameId(), bot.playerId());
        ExpectimaxYachtBotPolicy.BotDecision decision = decide(board, state);
        if (decision.action() == ExpectimaxYachtBotPolicy.Action.SCORE
                || state.activeRollCount() == RoundState.MAX_ROLL_COUNT) {
            ScoreCategory category = decision.category() == null
                    ? strategy.chooseCategory(state.activeDice(), scores.openCategories(
                            room.gameId(),
                            bot.playerId()
                    ))
                    : decision.category();
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
            return BotTurnStep.completed(state);
        }

        if (state.activeRollCount() < RoundState.MAX_ROLL_COUNT) {
            List<Boolean> held = preserveHeldDiceIdentity(
                    state.activeDice(),
                    state.activeHeld(),
                    decision.held()
            );
            if (!held.equals(state.activeHeld())) {
                RoundState heldState = actions.hold(
                        event.roomId(),
                        bot.playerId(),
                        new DiceHoldPayload(state.roundNumber(), held),
                        null
                );
                return BotTurnStep.continueAfterObservation(heldState);
            }
            RoundState current = rounds.findByRoomId(event.roomId()).orElse(null);
            if (!sameTurn(state, current)) {
                return BotTurnStep.ignored();
            }
            RoundState rolled = actions.roll(
                    event.roomId(),
                    bot.playerId(),
                    new DiceRollPayload(
                            current.roundNumber(),
                            current.activeRollCount() + 1,
                            held
                    ),
                    null
            );
            return BotTurnStep.completed(rolled);
        }

        return BotTurnStep.ignored();
    }

    private static List<Boolean> preserveHeldDiceIdentity(
            List<Integer> dice,
            List<Boolean> currentHeld,
            List<Boolean> desiredHeld
    ) {
        if (currentHeld == null || currentHeld.size() != dice.size()
                || desiredHeld.size() != dice.size()) {
            return desiredHeld;
        }

        int[] remainingByFace = new int[6];
        for (int index = 0; index < dice.size(); index++) {
            if (Boolean.TRUE.equals(desiredHeld.get(index))) {
                remainingByFace[dice.get(index) - 1]++;
            }
        }

        List<Boolean> resolved = new ArrayList<>(NO_HELD);
        for (int index = 0; index < dice.size(); index++) {
            int faceIndex = dice.get(index) - 1;
            if (Boolean.TRUE.equals(currentHeld.get(index)) && remainingByFace[faceIndex] > 0) {
                resolved.set(index, true);
                remainingByFace[faceIndex]--;
            }
        }
        for (int index = 0; index < dice.size(); index++) {
            int faceIndex = dice.get(index) - 1;
            if (!resolved.get(index) && remainingByFace[faceIndex] > 0) {
                resolved.set(index, true);
                remainingByFace[faceIndex]--;
            }
        }
        return List.copyOf(resolved);
    }

    private ExpectimaxYachtBotPolicy.BotDecision decide(ScoreBoard board, RoundState state) {
        try {
            return policy.decide(board, state.activeDice(), state.activeRollCount());
        } catch (RuntimeException exception) {
            log.warn(
                    "Expectimax 탐색에 실패해 안전 정책으로 전환합니다. round={} player={}",
                    state.roundNumber(),
                    state.activePlayerId(),
                    exception
            );
            List<ScoreCategory> open = java.util.Arrays.stream(ScoreCategory.values())
                    .filter(category -> board.categories().get(category.apiKey()) == null)
                    .toList();
            if (state.activeRollCount() == RoundState.MAX_ROLL_COUNT) {
                return ExpectimaxYachtBotPolicy.BotDecision.score(
                        strategy.chooseCategory(state.activeDice(), open),
                        0
                );
            }
            List<Boolean> held = strategy.chooseHeld(state.activeDice());
            if (held.stream().allMatch(Boolean.TRUE::equals)) {
                return ExpectimaxYachtBotPolicy.BotDecision.score(
                        strategy.chooseCategory(state.activeDice(), open),
                        0
                );
            }
            return ExpectimaxYachtBotPolicy.BotDecision.hold(held, 0);
        }
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

    record BotTurnStep(boolean acted, boolean continueAfterObservation, RoundState state) {

        static BotTurnStep ignored() {
            return new BotTurnStep(false, false, null);
        }

        static BotTurnStep completed(RoundState state) {
            return new BotTurnStep(true, false, state);
        }

        static BotTurnStep continueAfterObservation(RoundState state) {
            return new BotTurnStep(true, true, state);
        }
    }
}
