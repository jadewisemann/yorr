package com.ssafy.yorr.game.ranking.application;

import com.ssafy.yorr.game.match.repository.MatchParticipantRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Pageable;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 이 기능의 유일한 미묘한 지점은 <b>주간 경계</b>다. 경계를 KST로 계산해 UTC 벽시계로 넘기는
 * 환산이 어긋나면 주가 바뀌는 순간에만 틀리므로, 실제로 굴려서는 잡히지 않는다.
 * <p>
 * 2026-08-03은 월요일이다.
 */
class WeeklyRankingServiceTest {

    private final MatchParticipantRepository participants = mock(MatchParticipantRepository.class);

    private WeeklyRankingService serviceAt(String utcInstant) {
        when(participants.findWeeklyBest(any(), any(), any())).thenReturn(List.of());
        return new WeeklyRankingService(participants, Clock.fixed(Instant.parse(utcInstant), ZoneOffset.UTC));
    }

    private static LocalDateTime utc(String isoLocal) {
        return LocalDateTime.parse(isoLocal);
    }

    @Test
    void 월요일_0시_KST가_되는_순간부터_새_주를_센다() {
        // UTC 15:00 일요일 == KST 월요일 00:00
        var result = serviceAt("2026-08-02T15:00:00Z").currentWeek(10);

        assertThat(result.weekStart()).isEqualTo(LocalDate.of(2026, 8, 3));
        verify(participants).findWeeklyBest(
                utc("2026-08-02T15:00"), utc("2026-08-09T15:00"), Pageable.ofSize(10));
    }

    @Test
    void 월요일_0시_KST_1초_전은_아직_지난_주다() {
        // UTC 14:59:59 일요일 == KST 일요일 23:59:59
        var result = serviceAt("2026-08-02T14:59:59Z").currentWeek(10);

        assertThat(result.weekStart()).isEqualTo(LocalDate.of(2026, 7, 27));
        verify(participants).findWeeklyBest(
                utc("2026-07-26T15:00"), utc("2026-08-02T15:00"), Pageable.ofSize(10));
    }

    @Test
    void limit은_상한과_하한으로_잘린다() {
        serviceAt("2026-08-05T03:00:00Z").currentWeek(1000);
        serviceAt("2026-08-05T03:00:00Z").currentWeek(0);

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(participants, org.mockito.Mockito.times(2))
                .findWeeklyBest(any(), any(), pageable.capture());

        assertThat(pageable.getAllValues())
                .extracting(Pageable::getPageSize)
                .containsExactly(WeeklyRankingService.MAX_LIMIT, 1);
    }
}
