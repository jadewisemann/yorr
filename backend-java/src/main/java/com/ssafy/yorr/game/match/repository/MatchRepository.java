package com.ssafy.yorr.game.match.repository;

import com.ssafy.yorr.game.match.domain.Match;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface MatchRepository extends JpaRepository<Match, Long> {

    /** 같은 판이 두 번 쌓이지 않게 하는 빠른 경로. 최종 방어선은 game_id UNIQUE 제약이다. */
    boolean existsByGameId(String gameId);

    /**
     * 참가자까지 함께 읽는다. 판 하나를 보여줄 때는 참가자가 항상 따라오므로, 지연 로딩으로
     * 두 번 다녀오거나 트랜잭션 밖에서 터지게 두지 않는다.
     */
    @EntityGraph(attributePaths = "participants")
    Optional<Match> findWithParticipantsByGameId(String gameId);
}
