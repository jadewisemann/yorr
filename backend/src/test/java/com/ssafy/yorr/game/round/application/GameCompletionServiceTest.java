package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.match.application.MatchArchiveService;
import com.ssafy.yorr.game.repository.GameCompletionStore;
import com.ssafy.yorr.game.round.application.port.RoundDeadlineScheduler;
import com.ssafy.yorr.room.dto.RoomPhase;
import com.ssafy.yorr.room.dto.RoomSnapshot;
import com.ssafy.yorr.room.service.RoomService;
import com.ssafy.yorr.ws.RoomBroadcaster;
import com.ssafy.yorr.ws.RoomSessionRegistry;
import com.ssafy.yorr.ws.dto.GameOverPayload;
import com.ssafy.yorr.ws.dto.WsEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GameCompletionServiceTest {

    private static final String ROOM = "ROOM1";

    private GameCompletionStore completionStore;
    private MatchArchiveService matchArchiveService;
    private RoundDeadlineScheduler deadlineScheduler;
    private RoomSessionRegistry registry;
    private RoomBroadcaster broadcaster;
    private GameCompletionService service;

    @BeforeEach
    void setUp() {
        completionStore = mock(GameCompletionStore.class);
        deadlineScheduler = mock(RoundDeadlineScheduler.class);
        registry = mock(RoomSessionRegistry.class);
        broadcaster = mock(RoomBroadcaster.class);
        RoomService roomService = mock(RoomService.class);
        when(roomService.getSnapshot(ROOM)).thenReturn(new RoomSnapshot(
                ROOM, "game-1", "player-a", RoomPhase.PLAYING, 6, List.of()
        ));
        matchArchiveService = mock(MatchArchiveService.class);
        service = new GameCompletionService(
                completionStore, matchArchiveService, deadlineScheduler, roomService, registry, broadcaster
        );
    }

    /** 전이에 실패한(=이미 누가 종료시킨) 호출은 아무것도 방송하지 않는다. game.over 중복 방지의 핵심. */
    @Test
    void doesNothingWhenTheTransitionWasNotPerformed() {
        when(completionStore.finishIfComplete(ROOM, "game-1", false)).thenReturn(false);

        assertThat(service.finishIfComplete(ROOM, false)).isFalse();

        verify(broadcaster, never()).broadcast(anyString(), any());
        verify(deadlineScheduler, never()).cancelRoom(anyString());
        verify(registry, never()).markPhase(anyString(), any());
    }

    @Test
    void stopsTimersAndBroadcastsRankingsWhenItFinishesTheGame() {
        when(completionStore.finishIfComplete(ROOM, "game-1", true)).thenReturn(true);
        when(completionStore.readTotals(ROOM)).thenReturn(totals());

        assertThat(service.finishIfComplete(ROOM, true)).isTrue();

        // 타이머를 멈추지 않으면 종료 직후 만료가 한 번 더 돌아 다음 턴을 시작한다.
        verify(deadlineScheduler).cancelRoom(ROOM);
        verify(registry).markPhase(ROOM, com.ssafy.yorr.ws.dto.RoomPhase.FINISHED);

        ArgumentCaptor<WsEnvelope<?>> captor = ArgumentCaptor.forClass(WsEnvelope.class);
        verify(broadcaster, times(2)).broadcast(eq(ROOM), captor.capture());
        List<WsEnvelope<?>> messages = captor.getAllValues();
        assertThat(messages.get(0).type()).isEqualTo("game.over");
        // phase(finished)는 스냅샷으로만 전달된다 — 이게 없으면 클라가 결과 화면으로 넘어가지 못한다.
        assertThat(messages.get(1).type()).isEqualTo("state.sync");

        GameOverPayload payload = (GameOverPayload) messages.get(0).payload();
        assertThat(payload.rankings()).containsExactly(
                new GameOverPayload.Ranking(1, "player-b", 205),
                new GameOverPayload.Ranking(2, "player-a", 180),
                new GameOverPayload.Ranking(2, "player-c", 180),
                new GameOverPayload.Ranking(4, "player-d", 90)
        );
    }

    /** 동점은 같은 순위를 공유하고 그다음 순위는 인원수만큼 건너뛴다(1,2,2,4). */
    private static Map<String, Integer> totals() {
        LinkedHashMap<String, Integer> totals = new LinkedHashMap<>();
        totals.put("player-a", 180);
        totals.put("player-d", 90);
        totals.put("player-b", 205);
        totals.put("player-c", 180);
        return totals;
    }
}
