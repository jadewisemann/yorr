package com.ssafy.yorr.ws.dto;

/**
 * C→S: 턴 주인이 사발을 던졌다 — "지금 쏟아라"라는 연출 신호. (SSOT: DiceThrowPayload)
 * <p>
 * dice.roll 은 던지는 순간이 아니라 <b>흔들기 시작</b>에 올라온다(던질 때 결과를 기다리면 손을
 * 놓고 한 박자 뒤에야 주사위가 날아간다). 그래서 이 메시지가 없으면 관전자는 던진 시점을 알 수
 * 없어, 굴린 사람이 아직 흔드는 중인데 먼저 주사위를 쏟고 눈까지 보게 된다.
 * <p>
 * 서버 상태는 건드리지 않는다 — 눈은 dice.roll 에서 이미 확정됐다.
 */
public record DiceThrowPayload(
        int roundNumber,
        int rollCount
) {
}
