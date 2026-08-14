package com.ssafy.yorr.game.duel;

/**
 * 총을 뽑았다. reactionMs는 클라이언트가 신호를 본 순간부터 잰 값이고,
 * 음수면 신호 전에 뽑았다는 신고다(부정출발). 검증·판정은 {@link DuelRules}가 한다.
 */
public record DuelDrawPayload(long inputSeq, int reactionMs) {
}
