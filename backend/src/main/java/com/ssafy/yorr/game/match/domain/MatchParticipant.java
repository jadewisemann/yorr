package com.ssafy.yorr.game.match.domain;

import com.ssafy.yorr.user.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;

/**
 * 한 판에서 한 사람의 결과.
 * <p>
 * {@code user}가 없을 수 있다 — 게스트는 계정이 없기 때문이다. 그래도 행은 만든다. 판의
 * 모습(몇 명이서, 몇 점에, 몇 등)이 온전해야 나중에 그 판을 되짚을 수 있다. 랭킹 집계는
 * 회원 행만 세면 된다.
 * <p>
 * {@code displayNickname}을 따로 갖는 이유는 <b>그때 화면에 보였던 이름</b>이어야 하기
 * 때문이다. 회원이 프로필 닉네임을 바꾸거나 탈퇴해도 지난 판의 기록은 그대로여야 한다.
 */
@Entity
@Table(name = "match_participants")
@Getter
public class MatchParticipant {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "match_id", nullable = false)
    private Match match;

    /** 회원이면 그 계정, 게스트면 null. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    /** 방 안에서 쓰인 식별자. 회원·게스트 모두 있고, 판 안에서 사람을 구분하는 값이다. */
    @Column(name = "player_id", nullable = false, length = 64, updatable = false)
    private String playerId;

    @Column(name = "display_nickname", nullable = false, length = 20, updatable = false)
    private String displayNickname;

    @Column(name = "total_score", nullable = false)
    private int totalScore;

    /** 1부터. 동점은 같은 순위를 공유한다(1, 2, 2, 4). */
    @Column(nullable = false)
    private int ranking;

    protected MatchParticipant() {
    }

    private MatchParticipant(User user, String playerId, String displayNickname, int totalScore, int ranking) {
        this.user = user;
        this.playerId = playerId;
        this.displayNickname = displayNickname;
        this.totalScore = totalScore;
        this.ranking = ranking;
    }

    public static MatchParticipant of(User user, String playerId, String displayNickname,
                                      int totalScore, int ranking) {
        if (playerId == null || playerId.isBlank()) {
            throw new IllegalArgumentException("playerId must not be blank");
        }
        return new MatchParticipant(user, playerId, displayNickname, totalScore, ranking);
    }

    void belongTo(Match match) {
        this.match = match;
    }
}
