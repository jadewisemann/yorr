package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.DiceBroadcastPayload;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import com.ssafy.yorr.ws.dto.ScoreUpdatePayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import com.ssafy.yorr.game.service.ScoreConfirmationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.List;
import java.util.Optional;

import static com.ssafy.yorr.game.yacht.YachtDiceWsTypes.type;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.IntUnaryOperator;

/**
 * 마감 시각이 지난 턴을 서버가 대신 진행한다.
 * <p>
 * 예전에는 마감 시 턴만 넘겼고, 점수 기록은 클라이언트의 자동 제출에 의존했다. 그래서 한 번도
 * 굴리지 않았거나 탭이 백그라운드로 내려간 플레이어는 그 라운드 점수판이 비어버리고, 최종 결과가
 * 라운드 수와 맞지 않았다. 이제 서버가 끝까지 책임진다:
 * <ol>
 *   <li>굴림이 남아 있으면 마지막 KEEP을 유지한 채 한 번 대신 굴리고, 같은 턴에 시간을 다시 준다.</li>
 *   <li>굴림을 다 썼으면 아직 비어 있는 족보 중 하나를 골라 기록하고 다음 턴으로 넘긴다.</li>
 * </ol>
 * 어떤 경로로도 점수를 기록할 수 없을 때만(게임을 못 찾음·점수판 조회 실패·빈 족보 없음) 마지막
 * 수단으로 점수 없이 턴을 넘긴다.
 */
@Service
public class RoundTimeoutResolver {

    private static final Logger log = LoggerFactory.getLogger(RoundTimeoutResolver.class);

    private final RoundSynchronizationService roundSynchronizationService;
    private final ScoreRoundSubmissionService scoreRoundSubmissionService;
    private final ScoreConfirmationService scoreConfirmationService;
    private final RoomService roomService;
    private final RoomBroadcaster broadcaster;
    private final Clock clock;
    /** 남은 족보 개수를 받아 고를 인덱스를 돌려준다. 테스트에서 선택을 고정하기 위한 seam. */
    private final IntUnaryOperator categoryPicker;

    @Autowired
    public RoundTimeoutResolver(
            RoundSynchronizationService roundSynchronizationService,
            ScoreRoundSubmissionService scoreRoundSubmissionService,
            ScoreConfirmationService scoreConfirmationService,
            RoomService roomService,
            RoomBroadcaster broadcaster
    ) {
        this(
                roundSynchronizationService,
                scoreRoundSubmissionService,
                scoreConfirmationService,
                roomService,
                broadcaster,
                Clock.systemUTC(),
                bound -> ThreadLocalRandom.current().nextInt(bound)
        );
    }

    RoundTimeoutResolver(
            RoundSynchronizationService roundSynchronizationService,
            ScoreRoundSubmissionService scoreRoundSubmissionService,
            ScoreConfirmationService scoreConfirmationService,
            RoomService roomService,
            RoomBroadcaster broadcaster,
            Clock clock,
            IntUnaryOperator categoryPicker
    ) {
        this.roundSynchronizationService = roundSynchronizationService;
        this.scoreRoundSubmissionService = scoreRoundSubmissionService;
        this.scoreConfirmationService = scoreConfirmationService;
        this.roomService = roomService;
        this.broadcaster = broadcaster;
        this.clock = clock;
        this.categoryPicker = categoryPicker;
    }

    public RoundTimeoutResolution resolve(String roomId, int roundNumber, String activePlayerId) {
        Optional<RoundState> autoRolled =
                roundSynchronizationService.autoRoll(roomId, roundNumber, activePlayerId);
        if (autoRolled.isPresent()) {
            broadcastAutoRoll(roomId, activePlayerId, autoRolled.get());
            return RoundTimeoutResolution.autoRolled(autoRolled.get());
        }

        // 자동 굴림이 안 됐다 = 턴이 이미 넘어갔거나 굴림을 다 썼다. 둘을 구분해야 한다.
        RoundState current = roundSynchronizationService.findByRoomId(roomId).orElse(null);
        if (current == null
                || current.roundNumber() != roundNumber
                || !current.activePlayerId().equals(activePlayerId)) {
            return RoundTimeoutResolution.stale();
        }
        return recordAndAdvance(roomId, roundNumber, activePlayerId, current.activeDice());
    }

    private RoundTimeoutResolution recordAndAdvance(
            String roomId,
            int roundNumber,
            String activePlayerId,
            List<Integer> dice
    ) {
        if (dice == null) {
            // 굴림을 다 썼는데 주사위가 없을 수는 없다. 상태가 깨졌다는 뜻이라 턴만 넘긴다.
            log.warn("마감 처리: 굴림 결과가 없어 점수 없이 진행 room={} round={}", roomId, roundNumber);
            return advanceWithoutScore(roomId, roundNumber, activePlayerId);
        }

        ScoreCategory category;
        try {
            category = pickOpenCategory(roomId, activePlayerId);
        } catch (RuntimeException exception) {
            log.warn("마감 처리: 남은 족보를 읽지 못해 점수 없이 진행 room={} player={}",
                    roomId, activePlayerId, exception);
            return advanceWithoutScore(roomId, roundNumber, activePlayerId);
        }
        if (category == null) {
            return advanceWithoutScore(roomId, roundNumber, activePlayerId);
        }

        try {
            ScoreRoundSubmissionResult result = scoreRoundSubmissionService.submit(
                    roomId,
                    activePlayerId,
                    new RoundSubmitPayload(roundNumber, dice, category.apiKey())
            );
            broadcastScoreUpdate(roomId, result);
            log.info("마감 처리: {} 족보를 자동 기록 room={} round={} player={}",
                    category.apiKey(), roomId, roundNumber, activePlayerId);
            return RoundTimeoutResolution.advanced(result.round());
        } catch (RuntimeException exception) {
            log.warn("마감 처리: 자동 기록에 실패해 점수 없이 진행 room={} round={} player={}",
                    roomId, roundNumber, activePlayerId, exception);
            return advanceWithoutScore(roomId, roundNumber, activePlayerId);
        }
    }

    /** 아직 비어 있는 족보 중 하나. 게임을 찾지 못하거나 남은 족보가 없으면 null. */
    private ScoreCategory pickOpenCategory(String roomId, String playerId) {
        RoomSnapshot room = roomService.getSnapshot(roomId);
        if (room == null || room.gameId() == null || room.gameId().isBlank()) {
            log.warn("마감 처리: 진행 중인 게임을 찾지 못했다 room={}", roomId);
            return null;
        }
        List<ScoreCategory> open = scoreConfirmationService.openCategories(room.gameId(), playerId);
        if (open.isEmpty()) {
            log.warn("마감 처리: 남은 족보가 없다 room={} player={}", roomId, playerId);
            return null;
        }
        return open.get(Math.floorMod(categoryPicker.applyAsInt(open.size()), open.size()));
    }

    private RoundTimeoutResolution advanceWithoutScore(
            String roomId,
            int roundNumber,
            String activePlayerId
    ) {
        return roundSynchronizationService.expire(roomId, roundNumber, activePlayerId)
                .map(RoundTimeoutResolution::advanced)
                .orElseGet(RoundTimeoutResolution::stale);
    }

    private void broadcastAutoRoll(String roomId, String activePlayerId, RoundState state) {
        broadcaster.broadcast(roomId, new WsEnvelope<>(
                type("dice.broadcast"),
                clock.millis(),
                new DiceBroadcastPayload(
                        activePlayerId,
                        state.roundNumber(),
                        state.activeRollCount(),
                        state.activeDice(),
                        state.activeHeld(),
                        true
                ),
                roomId,
                null
        ));
        log.info("마감 처리: {}회차를 자동으로 굴렸다 room={} round={} player={}",
                state.activeRollCount(), roomId, state.roundNumber(), activePlayerId);
    }

    private void broadcastScoreUpdate(String roomId, ScoreRoundSubmissionResult result) {
        broadcaster.broadcast(roomId, new WsEnvelope<>(
                type("score.update"),
                clock.millis(),
                new ScoreUpdatePayload(
                        result.score().playerId(),
                        result.score().scoreboard()
                ),
                roomId,
                null
        ));
    }
}
