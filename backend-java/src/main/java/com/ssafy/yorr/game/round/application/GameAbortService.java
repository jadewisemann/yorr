package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.dto.RoomCloseReason;
import com.ssafy.yorr.ws.dto.RoomClosedPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.springframework.stereotype.Service;

@Service
public class GameAbortService {

    private final RoundSynchronizationService roundSynchronizationService;
    private final RoundTimerService roundTimerService;
    private final RoomBroadcaster broadcaster;

    public GameAbortService(
            RoundSynchronizationService roundSynchronizationService,
            RoundTimerService roundTimerService,
            RoomBroadcaster broadcaster
    ) {
        this.roundSynchronizationService = roundSynchronizationService;
        this.roundTimerService = roundTimerService;
        this.broadcaster = broadcaster;
    }

    /**
     * Stops an active game once. The room owner calls this after deciding that
     * the remaining participant count is below the minimum required to play.
     */
    public boolean abortForNotEnoughPlayers(String roomId) {
        if (!roundSynchronizationService.remove(roomId)) {
            return false;
        }

        roundTimerService.cancelRoom(roomId);
        broadcaster.broadcast(roomId, WsEnvelope.of(
                "room.closed",
                new RoomClosedPayload(RoomCloseReason.NOT_ENOUGH_PLAYERS)
        ).withRoomId(roomId));
        return true;
    }
}
