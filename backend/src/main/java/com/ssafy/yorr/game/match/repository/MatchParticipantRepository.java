package com.ssafy.yorr.game.match.repository;

import com.ssafy.yorr.game.match.domain.MatchParticipant;
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
     * @param from 포함. 주 시작 시각을 <b>UTC 벽시계</b>로 넘긴다({@code finished_at}과 같은 기준)
     * @param to   제외. 다음 주 시작 시각
     */
    @Query("""
            select p.user.id as userId, p.user.nickname as nickname,
                   max(p.totalScore) as bestScore
            from MatchParticipant p
            where p.user is not null
              and p.match.finishedAt >= :from
              and p.match.finishedAt < :to
            group by p.user.id, p.user.nickname
            order by max(p.totalScore) desc, p.user.id asc
            """)
    List<WeeklyBest> findWeeklyBest(@Param("from") LocalDateTime from,
                                    @Param("to") LocalDateTime to,
                                    Pageable pageable);
}
