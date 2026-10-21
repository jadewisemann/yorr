import { describe, expect, it } from 'vitest'
import {
  ballAt,
  ballX,
  duration,
  faultOf,
  flightDeadline,
  missDeadline,
  NORMAL_SPEED,
  progress,
  returnKind,
  SMASH_SPEED,
  WEAK_SPEED,
} from '../pingPongCourtMath.js'
import type { PingPongBall } from '../pingPongState.js'

/**
 * 궤적·판정 창의 순수 계산. **경계값 하네스**(TESTING.md 「경계값」)를 따른다 —
 * 창의 안쪽 한 칸과 바깥쪽 한 칸을 모두 짚는다. 여기 상수 하나를 조정하면
 * 아래 표가 빨개지는 것이 목적이다.
 *
 * 시각은 전부 인자로 주입되므로 가짜 타이머도 sleep도 필요 없다.
 */
const ball = (overrides: Partial<PingPongBall> = {}): PingPongBall => ({
  pos: 0,
  direction: 1,
  speed: NORMAL_SPEED,
  smash: false,
  faultFrom: 0,
  x0: 0.5,
  x1: 0.5,
  launchedAt: 1_000,
  ...overrides,
})

describe('progress / ballX / ballAt', () => {
  it('direction 1이면 그대로, -1이면 뒤집는다', () => {
    expect(progress(0.25, 1)).toBe(0.25)
    expect(progress(0.25, -1)).toBe(0.75)
  })

  it('ballX는 진행률을 0~1로 자른다 — 창 밖 위치도 화면 좌표는 테이블 안이다', () => {
    // pos 1.4는 진행률 1.4 — 클램프하지 않으면 공이 테이블 밖으로 그려진다.
    expect(ballX(ball({ pos: 1.4, x0: 0, x1: 1 }))).toBe(1)
    expect(ballX(ball({ pos: -0.4, x0: 0, x1: 1 }))).toBe(0)
    expect(ballX(ball({ pos: 0.5, x0: 0, x1: 1 }))).toBeCloseTo(0.5)
    // 역방향은 진행률이 뒤집히므로 보간도 반대다.
    expect(ballX(ball({ pos: 0.2, direction: -1, x0: 0, x1: 1 }))).toBeCloseTo(0.8)
  })

  it('ballAt은 pos와 launchedAt만 옮긴다 — 제자리 재표현이다', () => {
    const before = ball({ pos: 0.1, launchedAt: 1_000 })
    const after = ballAt(before, 1_500)

    // 0.5초 × 속도 1.0 = 0.5 전진.
    expect(after.pos).toBeCloseTo(0.6)
    expect(after.launchedAt).toBe(1_500)
    expect({ ...after, pos: 0, launchedAt: 0 }).toEqual({ ...before, pos: 0, launchedAt: 0 })
  })

  it('과거 시각을 주면 되감지 않는다(0으로 자른다)', () => {
    expect(ballAt(ball({ pos: 0.3, launchedAt: 1_000 }), 900).pos).toBeCloseTo(0.3)
  })
})

describe('duration', () => {
  it('거리/속도를 ms로 바꾸고 최소 1ms를 지킨다', () => {
    expect(duration(0, 1, 1)).toBe(1_000)
    expect(duration(0, 1, 2)).toBe(500)
    // 같은 자리면 0ms지만 0은 "이미 지남"과 구별되지 않으므로 1로 올린다.
    expect(duration(0.5, 0.5, 1)).toBe(1)
  })
})

describe('missDeadline / flightDeadline', () => {
  it('서브 공은 방향에 따라 놓치는 지점이 다르다', () => {
    // direction 1 → MISS_1(1.1), direction -1 → MISS_2(1 - 1.1 = -0.1).
    expect(missDeadline(ball({ pos: 0, direction: 1, speed: 1 }), 1_000)).toBe(2_100)
    expect(missDeadline(ball({ pos: 1, direction: -1, speed: 1 }), 1_000)).toBe(2_100)
  })

  it('폴트 공은 상대 라켓까지 가지 않는다 — NET은 네트, OUT은 테이블 밖', () => {
    const net = flightDeadline(ball({ pos: 0, direction: 1, fault: 'NET' }), 1_000)
    // 0.5/1.0 = 500ms
    expect(net).toBe(1_500)

    const out = flightDeadline(ball({ pos: 0, direction: 1, fault: 'OUT' }), 1_000)
    // 1.5/1.0 = 1500ms
    expect(out).toBe(2_500)

    // 역방향 OUT은 -0.5로 간다. pos 1에서 1.5 거리다.
    expect(flightDeadline(ball({ pos: 1, direction: -1, fault: 'OUT' }), 1_000)).toBe(2_500)
  })

  it('폴트가 없으면 놓치는 지점을 쓴다', () => {
    expect(flightDeadline(ball({ pos: 0, direction: 1 }), 1_000)).toBe(2_100)
  })
})

describe('faultOf', () => {
  /*
   * 이르면 OUT, 늦으면 NET. 창 끝에서 FAULT_BAND(0.04)만큼은 폴트가 아니다.
   * EARLY_MARGIN = 0.9-0.72 = 0.18, LATE_MARGIN = 1.06-0.9 = 0.16.
   * 따라서 경계는 이른 쪽 0.14, 늦은 쪽 0.12다.
   */
  it.each([
    // [거리, 이른가?, 기대]
    [0, true, undefined],
    [0.13, true, undefined],
    [0.14, true, undefined],
    [0.15, true, 'OUT'],
    [0.18, true, 'OUT'],
    [0, false, undefined],
    [0.11, false, undefined],
    [0.12, false, undefined],
    [0.13, false, 'NET'],
    [0.16, false, 'NET'],
  ])('거리 %s, 이른가 %s → %s', (distance, early, expected) => {
    expect(faultOf(distance, early)).toBe(expected)
  })
})

describe('returnKind', () => {
  it('폴트는 거리와 무관하게 자기 등급을 이긴다', () => {
    expect(returnKind(0, 'OUT')).toEqual({ speed: NORMAL_SPEED, smash: false, type: 'OUT' })
    // NET은 눌려서 약하다 — OUT과 속도가 다르다.
    expect(returnKind(0, 'NET')).toEqual({ speed: WEAK_SPEED, smash: false, type: 'NET' })
  })

  it.each([
    // [거리, 기대 type] — PERFECT 0.06, GOOD 0.1 경계.
    [0, 'SMASH'],
    [0.06, 'SMASH'],
    [0.061, 'NICE'],
    [0.1, 'NICE'],
    [0.101, 'OK'],
    [0.5, 'OK'],
  ])('건드린 거리 %s → %s', (distance, expected) => {
    expect(returnKind(distance, undefined).type).toBe(expected)
  })

  it('스매시만 속도가 다르고 NICE·OK는 기본 속도다', () => {
    expect(returnKind(0, undefined).speed).toBe(SMASH_SPEED)
    expect(returnKind(0.08, undefined).speed).toBe(NORMAL_SPEED)
    expect(returnKind(0.3, undefined).speed).toBe(WEAK_SPEED)
    expect(returnKind(0, undefined).smash).toBe(true)
    expect(returnKind(0.08, undefined).smash).toBe(false)
  })
})
