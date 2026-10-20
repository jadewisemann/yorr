import type { RoundRoomSnapshot } from './roundPorts.js'

/**
 * 턴 시계의 상수와 명단 판정.
 *
 * 왜 분리했나: 이 값들은 "이 방에 시계를 걸어야 하는가"라는 규칙 하나를 이루고, 타이머의
 * 상태 기계와 무관하다. 규칙을 바꿀 때 400줄짜리 클래스를 열지 않아도 되게 한다.
 */

/** 한 턴에 주어지는 시간. 클라이언트에는 이 마감 시각을 그대로 알린다. */
export const ROUND_DURATION_MS = 25_000

/**
 * 강제 진행을 마감 시각보다 이만큼 늦춘다.
 *
 * 마감 처리 자체는 서버가 한다(`RoundTimeoutResolver`). 다만 플레이어가 마감 직전에
 * 누른 round.submit이 아직 날아오는 중일 수 있고, 그 요청이 NOT_YOUR_TURN으로
 * 거절되면 본인이 고른 족보 대신 서버가 고른 족보가 기록된다. 왕복 시간과 클라
 * 시계 오차를 흡수할 만큼만 준다.
 */
export const EXPIRY_GRACE_MS = 1_000

/** 오프라인 상태로 자기 턴을 이 횟수째 맞으면 스킵 대신 자동 퇴장시킨다. */
export const MAX_OFFLINE_TURNS = 2

/**
 * 사람이 이 수 이하인 방은 **시계를 걸지 않는다**(연습 방).
 *
 * 턴 제한의 목적은 한 사람이 멈춰 있을 때 나머지가 무한정 기다리지 않게 하는 것이다.
 * 봇만 데리고 혼자 하는 방에는 기다리는 사람이 없으므로 그 목적이 사라진다 —
 * 25초는 족보를 따져 보는 사람에게 재촉이기만 하다. 봇은 자기 턴을 스스로 진행하므로
 * (`BotTurnOrchestrator`) 시계 없이도 판이 앞으로 간다.
 *
 * 여기 걸리면 `round.start`의 `deadline`이 **null로 나간다** — 프론트는 그때 타이머를
 * 그리지 않는다(`frontend/src/realtime/wsEvents.ts`의 `RoundStartPayload`).
 */
export const UNTIMED_HUMAN_LIMIT = 1

/** 방 명단이 근거다 — 명단에 없으면 봇이 아니다(사람으로 보고 오프라인 판정을 태운다). */
export function isBot(room: RoundRoomSnapshot | null, playerId: string): boolean {
  return (
    room?.players.some((player) => player.playerId === playerId && player.kind === 'BOT') ?? false
  )
}

/**
 * 봇을 뺀 사람 수로 판정한다 — 방 스냅샷을 못 읽었으면(비정상) 시계를 건다.
 * 판단이 안 서는 쪽에서는 **기존 동작**으로 떨어지는 것이 안전하다.
 */
export function isUntimedRoom(room: RoundRoomSnapshot | null): boolean {
  if (room === null) return false
  const humans = room.players.filter((player) => player.kind !== 'BOT').length
  return humans <= UNTIMED_HUMAN_LIMIT
}
