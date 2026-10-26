import type {
  PingPongBall,
  PingPongDirection,
  PingPongEventType,
  PingPongFault,
} from './pingPongState.js'

/**
 * 공의 궤적과 스윙 판정 — 시간·위치·등급만 다루는 순수 계산.
 *
 * 왜 분리했나: 이 값들은 **판정 창의 상수**에 전부 매여 있다(이상점 0.9, 창 0.72~1.06,
 * 폴트 띠 0.04). 상태 전이와 섞여 있으면 창을 조정할 때 규칙 전체를 읽어야 한다.
 */

export const NORMAL_SPEED = 1.0
export const SMASH_SPEED = 1.95
export const WEAK_SPEED = 0.82
export const WIN_SCORE = 11
/** 득점 후·전원 ready 후 다음 서브까지의 시간. */
export const POINT_COUNTDOWN_MILLIS = 2_600
/** 스윙을 과거로 되감을 수 있는 최대 폭 ({@link judgedAt} 참고). */
export const MAX_ROLLBACK_MILLIS = 120

/* ── 판정 창 (player 0 기준. player 1은 `1 - v` 미러) ───────────────────── */

/** 이상점 — 여기서 정확히 치면 스매시다. */
export const IDEAL_1 = 0.9
export const WINDOW_1_LOW = 0.72
export const WINDOW_1_HIGH = 1.06
/** 여기까지 오면 놓친 것으로 마감된다(라켓 뒤). */
const MISS_1 = 1.1
export const IDEAL_2 = 1 - IDEAL_1
export const WINDOW_2_LOW = 1 - WINDOW_1_HIGH
export const WINDOW_2_HIGH = 1 - WINDOW_1_LOW
const MISS_2 = 1 - MISS_1
const PERFECT_DISTANCE = 0.06
const GOOD_DISTANCE = 0.1
/** 창 끝에서 이만큼은 폴트 — 창 안이라도 이상점에서 멀면 OUT/NET이다. */
const FAULT_BAND = 0.04
const EARLY_MARGIN = IDEAL_1 - WINDOW_1_LOW
const LATE_MARGIN = WINDOW_1_HIGH - IDEAL_1

/** 진행률 — direction에 따라 pos를 0→1로 정규화한다. */
export const progress = (pos: number, direction: PingPongDirection): number =>
  direction > 0 ? pos : 1 - pos

/** `from → to`를 speed로 지나는 데 걸리는 시간(ms). 최소 1ms. */
export const duration = (from: number, to: number, speed: number): number =>
  Math.max(1, Math.round((Math.abs(to - from) / speed) * 1_000))

/** 서브한 공을 아무도 치지 않았을 때의 실점 시각. */
export const missDeadline = (ball: PingPongBall, now: number): number =>
  now + duration(ball.pos, ball.direction > 0 ? MISS_1 : MISS_2, ball.speed)

/**
 * 리턴한 공의 마감 시각. 폴트 공은 상대 라켓까지 가지 않는다 — NET은 네트
 * (진행률 0.5)에서, OUT은 테이블 밖(±0.5)에서 죽는다.
 */
export const flightDeadline = (ball: PingPongBall, now: number): number => {
  let target: number
  if (ball.fault === 'NET') target = 0.5
  else if (ball.fault === 'OUT') target = ball.direction > 0 ? 1.5 : -0.5
  else target = ball.direction > 0 ? MISS_1 : MISS_2
  return now + duration(ball.pos, target, ball.speed)
}

/**
 * `now` 시점으로 공을 전진시킨다. 궤적이 같으므로 `pos`·`launchedAt`만 옮기는
 * 재표현이고 상태 변화가 아니다.
 */
export const ballAt = (ball: PingPongBall, now: number): PingPongBall => {
  const elapsed = Math.max(0, now - ball.launchedAt) / 1_000
  return { ...ball, pos: ball.pos + ball.direction * ball.speed * elapsed, launchedAt: now }
}

/** 현재 좌우 위치 — `x0 → x1` 보간을 진행률로 잘라낸다. */
export const ballX = (ball: PingPongBall): number => {
  const p = progress(ball.pos, ball.direction)
  return ball.x0 + (ball.x1 - ball.x0) * Math.max(0, Math.min(1, p))
}

/**
 * 창 안이지만 이상점에서 먼 스윙의 폴트 판정. 이르면 OUT, 늦으면 NET이다
 * (일찍 치면 라켓 각이 서서 넘어가고, 늦으면 눌려서 네트에 걸린다).
 */
export const faultOf = (distance: number, early: boolean): PingPongFault | undefined => {
  const limit = (early ? EARLY_MARGIN : LATE_MARGIN) - FAULT_BAND
  if (distance <= limit) return undefined
  return early ? 'OUT' : 'NET'
}

/** 리턴의 성격 — 폴트가 있으면 그것이 이기고, 없으면 이상점과의 거리로 등급이 갈린다. */
export const returnKind = (
  distance: number,
  fault: PingPongFault | undefined,
): { readonly speed: number; readonly smash: boolean; readonly type: PingPongEventType } => {
  // 폴트 공도 속도가 다르다: OUT은 세게 넘어가고 NET은 눌려서 약하다.
  if (fault === 'OUT') return { speed: NORMAL_SPEED, smash: false, type: 'OUT' }
  if (fault === 'NET') return { speed: WEAK_SPEED, smash: false, type: 'NET' }
  if (distance <= PERFECT_DISTANCE) return { speed: SMASH_SPEED, smash: true, type: 'SMASH' }
  if (distance <= GOOD_DISTANCE) return { speed: NORMAL_SPEED, smash: false, type: 'NICE' }
  return { speed: WEAK_SPEED, smash: false, type: 'OK' }
}
