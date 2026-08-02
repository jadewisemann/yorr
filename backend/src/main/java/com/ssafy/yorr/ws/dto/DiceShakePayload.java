package com.ssafy.yorr.ws.dto;

/**
 * C→S: 턴 주인이 사발을 흔든 펄스 하나 — 관전 화면이 같은 손놀림을 따라 하도록 중계한다.
 * (SSOT: DiceShakePayload)
 * <p>
 * 폰으로 굴리면 사발의 흔들림은 기기 흔들림 펄스가 유일한 에너지원이라, 손을 멈추면 사발 속
 * 주사위도 잦아든다. 이 신호가 없으면 관전 화면은 정해진 애니메이션으로 계속 흔들려서
 * "굴린 사람은 멈췄는데 남의 화면에서만 계속 흔들리는" 상태가 된다.
 * <p>
 * dice.throw 와 같은 성격의 연출 신호다 — 서버 상태를 건드리지 않고, 유실되면 그 순간의
 * 흔들림만 관전 화면에 빠진다. 방향이 바뀔 때마다 올라오므로 다른 메시지보다 잦다(전송 측 제한).
 * <p>
 * dice.throw 와 달리 rollCount 는 싣지 않는다 — 흔들기는 dice.roll 보다 먼저 시작해서 클라이언트가
 * 아직 굴림 번호를 모른다. 한 턴에 화면에서 흔들리는 사발은 하나뿐이라 roundNumber 로 충분하다.
 */
public record DiceShakePayload(
        int roundNumber,
        String direction,
        double strength
) {
}
