package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.application.port.RoundStateStore;
import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmission;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;
import com.ssafy.yorr.ws.dto.RoundSubmitPayload;
import org.springframework.stereotype.Service;

import java.util.Collection;

@Service
public class RoundSynchronizationService {

    private final RoundStateStore roundStateStore;

    public RoundSynchronizationService(RoundStateStore roundStateStore) {
        this.roundStateStore = roundStateStore;
    }

    public RoundState initialize(String roomId, int roundNumber, Collection<String> participantIds) {
        RoundState initialState = RoundState.start(roundNumber, participantIds);
        roundStateStore.initialize(roomId, initialState);
        return initialState;
    }

    public RoundSubmissionResult submit(String roomId, String playerId, RoundSubmitPayload payload) {
        if (payload == null) {
            throw new IllegalArgumentException("payload must not be null");
        }
        RoundSubmission submission = new RoundSubmission(
                playerId,
                payload.roundNumber(),
                payload.dice(),
                payload.category()
        );
        return roundStateStore.submitAtomically(roomId, submission);
    }

    public void remove(String roomId) {
        roundStateStore.remove(roomId);
    }
}
