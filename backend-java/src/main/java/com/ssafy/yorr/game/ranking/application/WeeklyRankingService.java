package com.ssafy.yorr.game.ranking.application;

import com.ssafy.yorr.game.match.repository.MatchParticipantRepository;
import com.ssafy.yorr.game.match.repository.MatchParticipantRepository.WeeklyBest;
import com.ssafy.yorr.game.yacht.YachtDiceGameModule;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.List;

/**
 * 이번 주 최고점 랭킹. 집계의 권위는 MySQL 하나다 — 별도 순위 자료구조를 두지 않는다.
 * <p>
 * 랭킹이 바뀔 수 있는 시점은 판이 끝날 때뿐이고(한 판이 10~30분), 그때마다 다시 세면 된다.
 * 같은 값을 Redis에도 얹으면 두 곳이 각자 세는 구조가 되어 어긋난 뒤 스스로 복구하지 못한다.
 */
@Service
public class WeeklyRankingService {

    /**
     * 주간 경계는 <b>KST 월요일 00:00</b>이다. 서버 JVM 존과 무관하게 같은 경계를 쓰려면
     * 존을 코드에 고정해야 한다 — 인프라 설정(TZ 환경변수)에 맡기면 환경마다 갈린다.
     */
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 랭킹 보드가 한 화면에 보여줄 수 있는 상한. 그 이상은 요청해도 잘라낸다. */
    public static final int MAX_LIMIT = 100;

    private final MatchParticipantRepository participants;
    private final Clock clock;

    @Autowired
    public WeeklyRankingService(MatchParticipantRepository participants) {
        this(participants, Clock.systemUTC());
    }

    WeeklyRankingService(MatchParticipantRepository participants, Clock clock) {
        this.participants = participants;
        this.clock = clock;
    }

    /**
     * @param limit 상위 몇 명까지. 1 미만이면 1, {@link #MAX_LIMIT} 초과면 상한으로 맞춘다
     */
    @Transactional(readOnly = true)
    public WeeklyRanking currentWeek(int limit) {
        ZonedDateTime weekStart = weekStart();
        List<WeeklyBest> rows = participants.findWeeklyBest(
                YachtDiceGameModule.CODE,
                utcWallClock(weekStart),
                utcWallClock(weekStart.plusWeeks(1)),
                PageRequest.of(0, clampLimit(limit)));
        return new WeeklyRanking(weekStart.toLocalDate(), rows);
    }

    /**
     * 한 회원의 이번 주 순위. 상위 목록에 없어도 자기 자리를 알 수 있어야 한다 — 100위 밖이면
     * 목록만으로는 "내가 어디 있는지"에 영원히 답할 수 없다.
     *
     * @return 이번 주에 끝낸 판이 없으면 {@code null}. 0점과 구분한다 — 0점은 순위에 오르지만
     * 기록 없음은 오를 자리 자체가 없다
     */
    @Transactional(readOnly = true)
    public MyWeeklyRank myCurrentWeek(String userId) {
        ZonedDateTime weekStart = weekStart();
        LocalDateTime from = utcWallClock(weekStart);
        LocalDateTime to = utcWallClock(weekStart.plusWeeks(1));

        Integer best = participants.findWeeklyBestScoreOf(userId, YachtDiceGameModule.CODE, from, to);
        if (best == null) return null;

        long better = participants.countMembersScoringMoreThan(best, YachtDiceGameModule.CODE, from, to);
        return new MyWeeklyRank(weekStart.toLocalDate(), (int) better + 1, best);
    }

    /** 지금이 속한 주의 시작(KST 월요일 00:00). 월요일 당일이면 그 날 자신이 시작이다. */
    private ZonedDateTime weekStart() {
        return ZonedDateTime.now(clock.withZone(KST))
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .toLocalDate()
                .atStartOfDay(KST);
    }

    /**
     * {@code finished_at}은 UTC 벽시계로 저장되므로(MatchArchiveService의 Clock.systemUTC())
     * 비교 대상도 같은 기준으로 환산해 넘긴다. KST 월요일 00:00 == 일요일 15:00 UTC.
     */
    private static LocalDateTime utcWallClock(ZonedDateTime kst) {
        return kst.withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();
    }

    private static int clampLimit(int limit) {
        return Math.max(1, Math.min(limit, MAX_LIMIT));
    }

    /**
     * @param weekStart 이 순위가 속한 주의 시작 날짜(KST). 프론트의 "이번 주" 표기를 서버 기준으로
     *                  맞추려면 순위와 함께 나가야 한다
     * @param rows      점수 내림차순. 순위 번호는 붙이지 않는다 — 동점 처리 방식이 표현의 문제라
     *                  응답을 만드는 쪽에서 정한다
     */
    public record WeeklyRanking(LocalDate weekStart, List<WeeklyBest> rows) {
    }

    /**
     * @param rank 상위 목록과 <b>같은 번호 체계</b>다 — 동점은 같은 번호를 받고 다음을 건너뛴다.
     *             그래서 목록에 내가 있으면 거기 적힌 번호와 이 값이 일치한다
     */
    public record MyWeeklyRank(LocalDate weekStart, int rank, int bestScore) {
    }
}
