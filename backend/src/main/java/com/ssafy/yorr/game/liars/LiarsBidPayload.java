package com.ssafy.yorr.game.liars;

/** C→S {@code game.liars.bid} — "이 눈이 판에 최소 quantity개 있다". 검증은 {@link LiarsRules}가 한다. */
public record LiarsBidPayload(int quantity, int face) {
}
