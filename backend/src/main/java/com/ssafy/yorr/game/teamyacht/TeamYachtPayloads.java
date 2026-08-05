package com.ssafy.yorr.game.teamyacht;

import java.util.List;

/**
 * 조별과제 야트가 받는 WebSocket payload들. 계약의 SSOT는 프론트
 * {@code frontend/src/realtime/wsEvents.ts}이고 여기가 그걸 따라간다.
 * <p>
 * 서버가 내려보내는 건 {@link TeamYachtView} 하나다({@code game.team_yacht.state}).
 * 동표 룰렛 결과도 그 안의 {@code last}에 실려 나간다 — 연출용 이벤트를 따로 두지 않는다.
 */
public final class TeamYachtPayloads {

    private TeamYachtPayloads() {
    }

    /** C→S {@code game.team_yacht.roll} — 굴린다. 무엇을 굴릴지는 서버가 안다(잠기지 않은 전부). */
    public record Roll() {
    }

    /** C→S {@code game.team_yacht.keep} — 킵할 주사위 자리(0~4). */
    public record Keep(List<Integer> keep) {
    }

    /** C→S {@code game.team_yacht.vote} — 기록하고 싶은 족보 apiKey. */
    public record Vote(String category) {
    }
}
