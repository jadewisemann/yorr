package com.ssafy.yorr.game.round.application.port;

import java.time.Instant;

public interface RoundDeadlineScheduler {

    void schedule(String roomId, int roundNumber, Instant deadline, Runnable timeoutAction);

    void cancel(String roomId, int roundNumber);

    void cancelRoom(String roomId);
}
