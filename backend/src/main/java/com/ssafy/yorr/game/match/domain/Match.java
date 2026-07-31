package com.ssafy.yorr.game.match.domain;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import lombok.Getter;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 끝난 게임 한 판. 방이 사라져도 남는 유일한 기록이다.
 * <p>
 * {@code gameId}는 Redis가 발급한 게임 식별자이고 UNIQUE다 — 종료 방송이 두 번 일어나도
 * 같은 판이 두 번 쌓이지 않는다.
 */
@Entity
@Table(name = "matches")
@Getter
public class Match {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "game_id", nullable = false, length = 64, updatable = false)
    private String gameId;

    @Column(name = "game_code", nullable = false, length = 32, updatable = false)
    private String gameCode;

    @Column(name = "room_code", nullable = false, length = 12, updatable = false)
    private String roomCode;

    @Column(name = "player_count", nullable = false)
    private int playerCount;

    @Column(name = "finished_at", nullable = false, updatable = false)
    private LocalDateTime finishedAt;

    /**
     * 참가자는 판 밖에서 홀로 존재하지 않는다 — 판이 지워지면 함께 지워져야 하고, 판을 통해서만
     * 만들어진다. 그래서 생명주기를 판에 묶는다(애그리거트 루트).
     */
    @OneToMany(mappedBy = "match", cascade = CascadeType.ALL, orphanRemoval = true)
    private final List<MatchParticipant> participants = new ArrayList<>();

    protected Match() {
    }

    private Match(String gameId, String gameCode, String roomCode, LocalDateTime finishedAt) {
        this.gameId = gameId;
        this.gameCode = gameCode;
        this.roomCode = roomCode;
        this.finishedAt = finishedAt;
        this.playerCount = 0;
    }

    public static Match finished(String gameId, String gameCode, String roomCode, LocalDateTime finishedAt) {
        if (gameId == null || gameId.isBlank()) throw new IllegalArgumentException("gameId must not be blank");
        return new Match(gameId, gameCode, roomCode, finishedAt);
    }

    /** 참가자는 판을 통해서만 추가한다 — 인원 수를 따로 세다 어긋나는 일을 막는다. */
    public void add(MatchParticipant participant) {
        participants.add(participant);
        participant.belongTo(this);
        playerCount = participants.size();
    }
}
