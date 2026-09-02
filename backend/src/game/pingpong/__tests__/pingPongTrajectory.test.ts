import { describe, expect, it } from 'vitest'
import {
  expire,
  initial,
  NORMAL_SPEED,
  PING_PONG_WINDOWS,
  POINT_COUNTDOWN_MILLIS,
  ready,
  serve,
  serveReceiver,
  swing,
  WIN_SCORE,
} from '../pingPongRules.js'
import type { PingPongState } from '../pingPongState.js'
import { P1, P2, rallyState } from './pingPongFixtures.js'

/**
 * 탁구는 **틱 없는 해석 모델**이다. 공의 지금 위치는
 * `pos + direction × speed × 경과초` 하나로 복원되고, 서버는 프레임을 보내지 않는다.
 * 그래서 마감 시각과 판정 창의 경계가 곧 게임 규칙 자체다 — 한 자리만 어긋나도
 * 클라이언트가 서버와 다른 공을 그린다.
 *
 * 아래는 그 좌표계를 짚는다: 공이 어디서 죽는가, 어느 창에서 어떤 리턴이 나오는가,
 * 득점이 누구에게 가는가.
 */
const W = PING_PONG_WINDOWS

/** 판이 열려 공이 P1 쪽으로(direction=+1) 날아오는 상태. */

describe('마감 시각', () => {
  it('서브한 공은 라켓 뒤(MISS)까지 가는 시간만큼 뒤에 죽는다', () => {
    let state = initial([P1, P2], 1_000)
    state = ready(swing(state, P1, 0, 1_100, 0.5), P1, 1_200)
    state = ready(swing(state, P2, 0, 1_300, 0.5), P2, 1_400)
    // 전원 준비 → 카운트다운. 그 마감이 서브 시각이다.
    expect(state.phase).toBe('COUNTDOWN')
    expect(state.nextActionAt).toBe(1_400 + POINT_COUNTDOWN_MILLIS)

    const served = serve(state, 4_000, 0.7)

    // P1이 받으므로 공은 0에서 출발해 1.1까지 간다 — 속도 1.0이면 1,100ms다.
    expect(served.ball.pos).toBe(0)
    expect(served.ball.direction).toBe(1)
    expect(served.nextActionAt).toBe(4_000 + Math.round(W.miss1 * 1_000))
  })

  it('P2가 받는 서브는 반대쪽 끝에서 출발한다', () => {
    const state: PingPongState = { ...rallyState(), phase: 'COUNTDOWN', serveReceiverId: P2 }

    const served = serve(state, 4_000, 0.3)

    expect(served.ball.pos).toBe(1)
    expect(served.ball.direction).toBe(-1)
    // 1에서 -0.1까지 = 1.1만큼.
    expect(served.nextActionAt).toBe(4_000 + Math.round((1 - W.miss2) * 1_000))
  })

  it('네트에 걸린 공은 네트에서, 넘어간 공은 테이블 밖에서 죽는다', () => {
    // 이상점보다 많이 늦게 치면 NET, 많이 이르게 치면 OUT이다.
    const late = swing(rallyState({ pos: W.window1High - 0.001 }), P1, 0, 1_000, 0.5)
    const early = swing(rallyState({ pos: W.window1Low + 0.001 }), P1, 0, 1_000, 0.5)

    expect(late.ball.fault).toBe('NET')
    expect(early.ball.fault).toBe('OUT')
    // NET은 진행률 0.5(네트)에서, OUT은 테이블 밖(-0.5)에서 죽는다.
    expect(late.nextActionAt).toBeLessThan(early.nextActionAt)
    expect(late.nextActionAt).toBe(
      1_000 + Math.max(1, Math.round((Math.abs(0.5 - late.ball.pos) / late.ball.speed) * 1_000)),
    )
    expect(early.nextActionAt).toBe(
      1_000 + Math.max(1, Math.round((Math.abs(-0.5 - early.ball.pos) / early.ball.speed) * 1_000)),
    )
  })

  it('폴트 없는 리턴은 상대 라켓 뒤까지 가는 시간만큼 산다', () => {
    const returned = swing(rallyState({ pos: W.ideal1 }), P1, 0, 1_000, 0.5)

    expect(returned.ball.fault).toBeUndefined()
    expect(returned.ball.direction).toBe(-1)
    expect(returned.nextActionAt).toBe(
      1_000 + Math.round(((W.ideal1 - W.miss2) / returned.ball.speed) * 1_000),
    )
  })

  it('아무리 가까워도 마감은 최소 1ms 뒤다', () => {
    // 이미 네트를 지난 자리에서 NET 폴트가 나면 남은 거리가 0에 가깝다.
    const returned = swing(rallyState({ pos: 0.5 }), P2, 0, 1_000, 0.5)

    expect(returned.nextActionAt).toBeGreaterThan(1_000)
  })
})

describe('공의 현재 위치', () => {
  it('흐른 시간만큼 진행 방향으로 나아간다', () => {
    const state = rallyState({ launchedAt: 1_000, pos: 0.2, speed: 2 })

    // 0.2 + (+1) × 2 × 0.5초 = 1.2 → 라켓 뒤라 P1이 놓친 것으로 마감된다.
    const missed = expire(state, 1_500)

    expect(missed.ball.pos).toBeCloseTo(1.2, 6)
    expect(missed.scores[P2]).toBe(1)
  })

  it('시각이 뒤로 가도 공은 되돌아가지 않는다', () => {
    const state = rallyState({ launchedAt: 2_000, pos: 0.3 })

    const swung = swing(state, P1, 0, 1_000, 0.5)

    // 발사 전 시각이면 경과를 0으로 눌러 출발점 그대로 본다.
    expect(swung.ball.pos).toBeCloseTo(0.3, 6)
  })

  it('좌우는 진행률로 잘라 보간하고 양 끝에서 멈춘다', () => {
    const beforeStart = swing(rallyState({ pos: 0, x0: 0.2, x1: 0.8 }), P1, 0, 1_000, 0.5)
    expect(beforeStart.ball.x0).toBeCloseTo(0.2, 6)

    const afterEnd = swing(rallyState({ pos: W.ideal1, x0: 0.2, x1: 0.8 }), P1, 0, 1_000, 0.5)
    // 진행률 0.9에서 잘린 보간값이지 끝값(0.8)이 아니다.
    expect(afterEnd.ball.x0).toBeCloseTo(0.2 + 0.6 * W.ideal1, 6)

    const clamped = swing(rallyState({ pos: 1.05, x0: 0.2, x1: 0.8 }), P1, 0, 1_000, 0.5)
    expect(clamped.ball.x0).toBeCloseTo(0.8, 6)
  })
})

describe('판정 창의 경계', () => {
  const swingAt = (pos: number, seat: 0 | 1 = 0) => {
    const direction = seat === 0 ? 1 : -1
    return swing(rallyState({ direction, pos }), seat === 0 ? P1 : P2, 0, 1_000, 0.5)
  }

  it('창보다 이르면 TOO_EARLY, 늦으면 TOO_LATE이고 공은 그대로 날아간다', () => {
    const early = swingAt(W.window1Low - 0.001)
    const late = swingAt(W.window1High + 0.001)

    expect(early.lastEvent?.type).toBe('TOO_EARLY')
    expect(late.lastEvent?.type).toBe('TOO_LATE')
    // 헛스윙이므로 방향이 바뀌지 않는다.
    expect(early.ball.direction).toBe(1)
    expect(late.ball.direction).toBe(1)
  })

  it('P2 쪽 창은 좌우가 뒤집힌다', () => {
    const early = swingAt(W.window2High + 0.001, 1)
    const late = swingAt(W.window2Low - 0.001, 1)

    expect(early.lastEvent?.type).toBe('TOO_EARLY')
    expect(late.lastEvent?.type).toBe('TOO_LATE')
  })

  it('창의 양 끝은 헛스윙이 아니라 폴트 리턴이다', () => {
    const atLow = swingAt(W.window1Low)
    const atHigh = swingAt(W.window1High)

    expect(atLow.lastEvent?.type).toBe('OUT')
    expect(atHigh.lastEvent?.type).toBe('NET')
  })

  it('이상점에 가까울수록 좋은 리턴이 나온다', () => {
    const perfect = swingAt(W.ideal1)
    const nice = swingAt(W.ideal1 + W.goodDistance)
    const ok = swingAt(W.ideal1 + W.goodDistance + 0.001)

    expect(perfect.lastEvent?.type).toBe('SMASH')
    expect(perfect.ball.smash).toBe(true)
    expect(perfect.ball.speed).toBe(W.smashSpeed)

    expect(nice.lastEvent?.type).toBe('NICE')
    expect(nice.ball.smash).toBe(false)
    expect(nice.ball.speed).toBe(NORMAL_SPEED)

    expect(ok.lastEvent?.type).toBe('OK')
    expect(ok.ball.speed).toBe(W.weakSpeed)
  })

  it('완벽 판정의 경계는 거리 그 자체다', () => {
    expect(swingAt(W.ideal1 + W.perfectDistance).lastEvent?.type).toBe('SMASH')
    expect(swingAt(W.ideal1 + W.perfectDistance + 0.001).lastEvent?.type).toBe('NICE')
  })

  it('폴트 공도 속도가 다르다 — OUT은 세고 NET은 약하다', () => {
    const out = swingAt(W.window1Low)
    const net = swingAt(W.window1High)

    expect(out.ball.speed).toBe(NORMAL_SPEED)
    expect(net.ball.speed).toBe(W.weakSpeed)
    expect(out.ball.smash).toBe(false)
    expect(net.ball.smash).toBe(false)
  })

  it('폴트 리턴은 랠리를 늘리지 않는다', () => {
    const clean = swing(rallyState({ pos: W.ideal1 }), P1, 0, 1_000, 0.5)
    const fouled = swing(rallyState({ pos: W.window1High }), P1, 0, 1_000, 0.5)

    expect(clean.rally).toBe(1)
    expect(fouled.rally).toBe(0)
  })
})

describe('득점이 가는 쪽', () => {
  it('받지 못한 공은 상대에게 점수를 준다', () => {
    // P1에게 가던 공이 마감 → P2 득점.
    expect(expire(rallyState({ pos: W.miss1 }), 1_000).scores[P2]).toBe(1)
    // P2에게 가던 공이 마감 → P1 득점.
    expect(expire(rallyState({ direction: -1, pos: W.miss2 }), 1_000).scores[P1]).toBe(1)
  })

  it('폴트 공은 친 쪽이 잃는다', () => {
    // P1이 쳐서 P2에게 가던 폴트 공(direction=-1) → P2 득점.
    const fromP1 = rallyState({ direction: -1, fault: 'NET', pos: 0.5 })
    expect(expire(fromP1, 1_000).scores[P2]).toBe(1)

    const fromP2 = rallyState({ direction: 1, fault: 'OUT', pos: 0.5 })
    expect(expire(fromP2, 1_000).scores[P1]).toBe(1)
  })

  it('진행 중이 아닌 판의 마감은 아무것도 하지 않는다', () => {
    const counting: PingPongState = { ...rallyState(), phase: 'COUNTDOWN' }

    expect(expire(counting, 9_000)).toBe(counting)
  })

  it('득점하면 다음 서브 카운트다운이 잡힌다', () => {
    const scored = expire(rallyState({ pos: W.miss1 }), 5_000)

    expect(scored.phase).toBe('COUNTDOWN')
    expect(scored.nextActionAt).toBe(5_000 + POINT_COUNTDOWN_MILLIS)
    expect(scored.version).toBe(6)
    expect(scored.lastEvent?.type).toBe('POINT')
  })

  it('11점을 2점 차로 앞서야 끝난다', () => {
    const deuce = expire(rallyState({ pos: W.miss1 }, { [P1]: 10, [P2]: 10 }), 5_000)
    expect(deuce.scores[P2]).toBe(WIN_SCORE)
    // 11:10은 한 점 차라 아직 끝나지 않는다.
    expect(deuce.phase).toBe('COUNTDOWN')

    const won = expire(rallyState({ pos: W.miss1 }, { [P1]: 9, [P2]: 10 }), 5_000)
    expect(won.phase).toBe('FINISHED')
    expect(won.nextActionAt).toBe(0)
    expect(won.serveReceiverId).toBeUndefined()
    expect(won.lastEvent?.type).toBe('GAME_OVER')
  })

  it('10점으로는 끝나지 않는다', () => {
    const nearWin = expire(rallyState({ pos: W.miss1 }, { [P1]: 0, [P2]: WIN_SCORE - 2 }), 5_000)

    expect(nearWin.scores[P2]).toBe(WIN_SCORE - 1)
    expect(nearWin.phase).toBe('COUNTDOWN')
  })
})

describe('서브 교대', () => {
  it('2점마다 바뀌다가 10:10부터는 매 점마다 바뀐다', () => {
    const order = [P1, P2]
    const receiver = (a: number, b: number) => serveReceiver(order, { [P1]: a, [P2]: b })

    expect(receiver(0, 0)).toBe(P1)
    expect(receiver(1, 0)).toBe(P1)
    expect(receiver(1, 1)).toBe(P2)
    expect(receiver(2, 1)).toBe(P2)
    expect(receiver(2, 2)).toBe(P1)

    // 합계 20(10:10)부터는 한 점마다.
    expect(receiver(10, 10)).toBe(P1)
    expect(receiver(11, 10)).toBe(P2)
    expect(receiver(11, 11)).toBe(P1)
  })

  it('점수가 없는 사람도 0으로 읽는다', () => {
    expect(serveReceiver([P1, P2], {})).toBe(P1)
  })
})
