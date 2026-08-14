package com.ssafy.yorr.game.match.repository;

import com.ssafy.yorr.config.CacheConfig;
import com.ssafy.yorr.game.match.domain.MatchParticipant;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 참가자 결과를 가로로(판을 넘어) 읽는다. 판 하나를 보여주는 조회는 {@link MatchRepository}가
 * 애그리거트째로 처리하므로, 여기에는 집계처럼 참가자 행 자체를 대상으로 하는 질의만 둔다.
 */
public interface MatchParticipantRepository extends JpaRepository<MatchParticipant, Long> {

    /** 한 회원의 주간 최고점 한 줄. 닉네임은 지난 판의 표시 이름이 아니라 <b>현재</b> 프로필 이름이다. */
    interface WeeklyBest {
        String getUserId();

        String getNickname();

        int getBestScore();
    }

    /**
     * 기간 안에 끝난 판들에서 회원별 <b>한 판 최고점</b>을 뽑는다.
     * <p>
     * {@code p.user}를 참조하는 것만으로 users와 inner join이 걸려 게스트 행(user_id NULL)이
     * 빠진다. 그래도 {@code is not null}을 명시하는 이유는 "회원만 센다"가 이 질의의 의도이고,
     * 조인 방식이 바뀌어도 그 의도가 남아야 하기 때문이다.
     * <p>
     * 정렬에 {@code userId}를 덧붙인 건 동점자 순서를 고정하기 위함이다 — 없으면 같은 요청이
     * 호출마다 다른 순서를 낼 수 있고, 페이징에서 행이 중복·누락된다.
     *
     * 캐시 키에 {@code from}이 들어가므로 주가 바뀌면 자연히 다른 항목이 된다 — 주 경계에서
     * 지난 주 순위가 잠시 남아 보이는 경로가 없다. 판이 끝나면
     * {@code MatchArchiveService}가 통째로 비운다.
     *
     * @param from 포함. 주 시작 시각을 <b>UTC 벽시계</b>로 넘긴다({@code finished_at}과 같은 기준)
     * @param to   제외. 다음 주 시작 시각
     */
    @Cacheable(cacheNames = CacheConfig.WEEKLY_RANKING,
            key = "#gameCode + '|' + #from.toString() + '|' + #pageable.pageSize")
    @Query("""
            select p.user.id as userId, p.user.nickname as nickname,
                   max(p.totalScore) as bestScore
            from MatchParticipant p
            where p.user is not null
              and p.match.gameCode = :gameCode
              and p.match.finishedAt >= :from
              and p.match.finishedAt < :to
            group by p.user.id, p.user.nickname
            order by max(p.totalScore) desc, p.user.id asc
            """)
    List<WeeklyBest> findWeeklyBest(@Param("gameCode") String gameCode,
                                    @Param("from") LocalDateTime from,
                                    @Param("to") LocalDateTime to,
                                    Pageable pageable);

    /**
     * 한 회원의 주간 최고점. 이번 주에 끝낸 판이 없으면 {@code null}이다 — 0점과 구분해야 한다.
     * 0점은 순위에 오르지만 기록 없음은 오를 자리 자체가 없다.
     * <p>
     * 사용자별 값이라 캐시하지 않는다. 상위 목록 캐시에 이걸 섞으면 키에 사용자가 들어가
     * 회원 수만큼 캐시가 늘어난다.
     */
    @Query("""
            select max(p.totalScore)
            from MatchParticipant p
            where p.user.id = :userId
              and p.match.gameCode = :gameCode
              and p.match.finishedAt >= :from
              and p.match.finishedAt < :to
            """)
    Integer findWeeklyBestScoreOf(@Param("userId") String userId,
                                  @Param("gameCode") String gameCode,
                                  @Param("from") LocalDateTime from,
                                  @Param("to") LocalDateTime to);

    /**
     * 주간 최고점이 {@code score}보다 <b>높은</b> 회원 수. 내 순위는 이 값 + 1이다.
     * <p>
     * 최고점을 다시 집계하지 않고 판 행을 바로 세는 이유: 어떤 판이든 {@code score}를 넘긴
     * 회원은 그 주 최고점도 {@code score}를 넘고, 반대도 성립한다. 그래서 회원을 중복 없이
     * 세는 것만으로 "나보다 잘한 회원 수"가 나온다.
     * <p>
     * 초과(>)만 세는 것이 {@code WeeklyRankingResponse}의 동점 처리(1, 2, 2, 4)와 같은 번호를
     * 만든다 — 목록에서도 내 앞에 있는 사람은 나보다 점수가 <b>높은</b> 사람뿐이다.
     */
    @Query("""
            select count(distinct p.user.id)
            from MatchParticipant p
            where p.user is not null
              and p.match.gameCode = :gameCode
              and p.match.finishedAt >= :from
              and p.match.finishedAt < :to
              and p.totalScore > :score
            """)
    long countMembersScoringMoreThan(@Param("score") int score,
                                     @Param("gameCode") String gameCode,
                                     @Param("from") LocalDateTime from,
                                     @Param("to") LocalDateTime to);
}
