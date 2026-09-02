import { describe, expect, it } from 'vitest'
import {
  expire,
  forfeit,
  hostReport,
  initial,
  judgedAt,
  NORMAL_SPEED,
  POINT_COUNTDOWN_MILLIS,
  ready,
  serve,
  serveReceiver,
  swing,
  WIN_SCORE,
} from '../pingPongRules.js'
import type { PingPongState } from '../pingPongState.js'

/**
 * 탁구 규칙 7종. 모든 시각은 인자로 주입하므로
 * **실시간 sleep도 가짜 타이머도 필요 없다** — 규칙이 순수 함수이기 때문이다.
 */
const P1 = 'player-1'
const P2 = 'player-2'

/** 판 시작까지 — 연습 → ready → 전원 ready → 서브. */
const startMatch = (): PingPongState => {
  let state = initial([P1, P2], 1_000)
  state = swing(state, P1, 0, 1_100, 0.5)
  state = ready(state, P1, 1_200)
  state = swing(state, P2, 0, 1_300, 0.5)
  state = ready(state, P2, 1_400)
  return serve(state, 4_000, 0.7)
}

/** 임의 점수의 랠리 상태를 직접 심는다. */
const playingAtScore = (p1: number, p2: number): PingPongState => ({
  version: 1,
  phase: 'PLAYING',
  playerOrder: [P1, P2],
  scores: { [P1]: p1, [P2]: p2 },
  lastInputSeq: { [P1]: -1, [P2]: -1 },
  readyPlayerIds: [P1, P2],
  ball: {
    pos: 0,
    direction: 1,
    speed: NORMAL_SPEED,
    smash: false,
    faultFrom: 0,
    x0: 0.5,
    x1: 0.5,
    launchedAt: 1_000,
  },
  rally: 0,
  serveReceiverId: P1,
  nextActionAt: 2_000,
})

describe('PingPongRules', () => {
  it('업링크 지연은 되감아 주되 미래에서 온 스윙과 죽은 공을 친 스윙은 잘라낸다', () => {
    // 되감기 한계 120ms = MAX_ROLLBACK_MILLIS.
    expect(judgedAt(10_000, 9_920)).toBe(9_920)
    expect(judgedAt(10_000, 10_050)).toBe(10_000)
    expect(judgedAt(10_000, 9_000)).toBe(9_880)
  })

  it('이상점 타이밍은 스매시가 되고 같은 inputSeq 재전송은 무시된다', () => {
    const served = startMatch()

    // 4_900 = 서브 후 0.9초 → 공이 정확히 이상점(0.9)에 있다.
    const smashed = swing(served, P1, 1, 4_900, 0.3)
    const duplicate = swing(smashed, P1, 1, 4_901, 0.4)

    expect(smashed.ball.direction).toBe(-1)
    expect(smashed.ball.smash).toBe(true)
    expect(smashed.ball.fault).toBeUndefined()
    expect(smashed.rally).toBe(1)
    expect(smashed.lastEvent?.type).toBe('SMASH')
    // 무시는 "같은 상태를 그대로 돌려주기"로 표현된다 — 스토어가 version으로 판정한다.
    expect(duplicate).toBe(smashed)
  })

  it('공을 놓치면 상대가 득점하고 1점째에는 서브가 그대로다', () => {
    const served = startMatch()

    const point = expire(served, served.nextActionAt)

    expect(point.phase).toBe('COUNTDOWN')
    expect(point.scores).toMatchObject({ [P2]: 1, [P1]: 0 })
    expect(point.serveReceiverId).toBe(P1)
    expect(point.lastEvent?.type).toBe('POINT')
  })

  it('서브는 2점마다 교대하고 듀스부터는 매 점 교대한다', () => {
    const players = [P1, P2]

    expect(serveReceiver(players, { [P1]: 0, [P2]: 0 })).toBe(P1)
    expect(serveReceiver(players, { [P1]: 0, [P2]: 1 })).toBe(P1)
    expect(serveReceiver(players, { [P1]: 1, [P2]: 1 })).toBe(P2)
    expect(serveReceiver(players, { [P1]: 10, [P2]: 10 })).toBe(P1)
    expect(serveReceiver(players, { [P1]: 11, [P2]: 10 })).toBe(P2)
    expect(serveReceiver(players, { [P1]: 11, [P2]: 11 })).toBe(P1)
  })

  it('듀스는 2점 차가 나야 끝난다', () => {
    const deuce = playingAtScore(10, 10)
    const advantage = expire(deuce, deuce.nextActionAt)

    expect(advantage.phase).toBe('COUNTDOWN')
    expect(advantage.scores[P2]).toBe(11)

    const matchPoint = playingAtScore(10, 11)
    const finished = expire(matchPoint, matchPoint.nextActionAt)

    expect(finished.phase).toBe('FINISHED')
    expect(finished.scores[P2]).toBe(12)
    expect(finished.lastEvent?.type).toBe('GAME_OVER')
    // 끝난 판에는 다음 리시버가 없다 — 필드 자체가 생략된다(NON_NULL).
    expect(finished.serveReceiverId).toBeUndefined()
  })

  it('이탈한 플레이어는 매치를 몰수한다', () => {
    const state = initial([P1, P2], 1_000)

    const finished = forfeit(state, P1, 2_000)

    expect(finished.phase).toBe('FINISHED')
    expect(finished.scores[P2]).toBe(WIN_SCORE)
    expect(finished.lastEvent?.type).toBe('OPPONENT_LEFT')
    expect(finished.lastEvent?.playerId).toBe(P2)
  })

  it('카운트다운은 두 사람이 연습 스윙을 하고 ready를 누른 뒤에 시작된다', () => {
    const state = initial([P1, P2], 1_000)
    expect(state.phase).toBe('PREPARING')
    expect(state.nextActionAt).toBe(0)

    // 연습 스윙 전 ready는 **무효** — 모션 입력이 동작한다는 핸드셰이크이기 때문이다.
    const ignoredReady = ready(state, P1, 1_100)
    expect(ignoredReady).toBe(state)

    const p1Practiced = swing(state, P1, 0, 1_200, 0.5)
    expect(p1Practiced.lastEvent?.type).toBe('PRACTICE')
    const p1Ready = ready(p1Practiced, P1, 1_300)
    expect(p1Ready.phase).toBe('PREPARING')
    expect(p1Ready.readyPlayerIds).toEqual([P1])

    const p2Practiced = swing(p1Ready, P2, 0, 1_400, 0.5)
    const allReady = ready(p2Practiced, P2, 1_500)
    expect(allReady.phase).toBe('COUNTDOWN')
    expect([...allReady.readyPlayerIds].sort()).toEqual([P1, P2])
    expect(allReady.nextActionAt).toBe(1_500 + POINT_COUNTDOWN_MILLIS)
  })

  /**
   * 스윙 판정의 **무시·기록만 하는 갈래들**. 실제로 랠리가 이어지는 갈래보다 수가 많고,
   * 하나라도 새면 "친 적 없는 스윙이 판을 바꾼다"가 된다.
   */
  it('내게 오는 공이 아니면 입력 번호만 남기고 공은 그대로 간다', () => {
    const served = startMatch()

    // 공은 P1에게 가는 중이다 — P2가 휘둘러도 라켓에 닿을 것이 없다.
    const swung = swing(served, P2, 1, 4_500, 0.5)

    expect(swung.ball.direction).toBe(served.ball.direction)
    expect(swung.rally).toBe(served.rally)
    expect(swung.lastInputSeq[P2]).toBe(1)
    expect(swung.version).toBe(served.version + 1)
  })

  it('판정 창을 벗어난 스윙은 헛스윙으로 남고 공은 계속 날아간다', () => {
    const served = startMatch()

    // 4_200 = 서브 후 0.2초 → 공이 아직 창(0.72) 앞이다.
    const tooEarly = swing(served, P1, 1, 4_200, 0.5)
    expect(tooEarly.lastEvent?.type).toBe('TOO_EARLY')
    expect(tooEarly.ball.direction).toBe(1)

    // 5_090 = 창(1.06)을 지난 뒤.
    const tooLate = swing(served, P1, 2, 5_090, 0.5)
    expect(tooLate.lastEvent?.type).toBe('TOO_LATE')
    expect(tooLate.ball.direction).toBe(1)
  })

  it('이상점에서 멀면 폴트가 되고 폴트 공은 네트나 테이블 밖에서 죽는다', () => {
    const served = startMatch()

    // 4_750 = 0.75 → 이상점(0.9)보다 이르고 창 안 → OUT.
    const out = swing(served, P1, 1, 4_750, 0.5)
    expect(out.lastEvent?.type).toBe('OUT')
    expect(out.ball.fault).toBe('OUT')

    // 5_030 = 1.03 → 이상점보다 늦고 창 안 → NET.
    const net = swing(served, P1, 2, 5_030, 0.5)
    expect(net.lastEvent?.type).toBe('NET')
    expect(net.ball.fault).toBe('NET')

    // 폴트 공이 죽는 순간 상대가 아니라 **친 사람의 상대**가 득점한다.
    const scored = expire(net, net.nextActionAt)
    expect(scored.scores[P2]).toBe(1)
  })

  it('폴트 공이 날아가는 동안의 스윙은 입력 번호만 남긴다', () => {
    const net = swing(startMatch(), P1, 1, 5_030, 0.5)

    const during = swing(net, P2, 1, 5_100, 0.5)

    expect(during.ball).toEqual(net.ball)
    expect(during.lastInputSeq[P2]).toBe(1)
    expect(during.version).toBe(net.version + 1)
  })

  it('이상점에서 조금 벗어난 리턴은 등급만 낮아진다', () => {
    const served = startMatch()

    // 0.98 → 이상점(0.9)과의 거리 0.08. PERFECT(0.06)보다 멀고 GOOD(0.1) 안 → NICE.
    const nice = swing(served, P1, 1, 4_980, 0.5)
    expect(nice.lastEvent?.type).toBe('NICE')
    expect(nice.ball.smash).toBe(false)

    // 1.01 → 거리 0.11. GOOD 밖이지만 늦은 쪽 폴트 한계(0.12) 안 → OK.
    const ok = swing(served, P1, 2, 5_010, 0.5)
    expect(ok.lastEvent?.type).toBe('OK')
  })

  it('두 사람이 아닌 명단으로는 판을 열 수 없다', () => {
    expect(() => initial([P1], 1_000)).toThrow('ping_pong_requires_two_players')
  })

  it('카운트다운이 아닐 때의 서브와 진행 중이 아닐 때의 만료는 아무것도 하지 않는다', () => {
    const preparing = initial([P1, P2], 1_000)

    expect(serve(preparing, 4_000, 0.7)).toBe(preparing)
    expect(expire(preparing, 4_000)).toBe(preparing)
  })

  it('방에 없는 사람의 이탈과 이미 끝난 판의 이탈은 아무것도 하지 않는다', () => {
    const state = initial([P1, P2], 1_000)
    expect(forfeit(state, '구경꾼', 2_000)).toBe(state)

    const finished = forfeit(state, P1, 2_000)
    expect(forfeit(finished, P2, 3_000)).toBe(finished)
  })

  /**
   * 대시보드 보고의 통과 조건 넷(`hostReport`). 하나라도 새면 플레이어가 자기 점수를
   * 올리거나 끝난 판이 다시 열린다.
   */
  it('대시보드 보고는 보낸 사람·version·명단·종료 여부를 모두 통과해야 받아들여진다', () => {
    const current = playingAtScore(3, 2)
    const reported: PingPongState = { ...current, version: 2, scores: { [P1]: 4, [P2]: 2 } }

    expect(hostReport(current, reported, 'dashboard-1')).toMatchObject({
      version: 2,
      scores: { [P1]: 4 },
    })

    // 1. 플레이어가 보낸 보고는 받지 않는다.
    expect(hostReport(current, reported, P1)).toBeNull()
    // 2. version이 늘지 않은 보고는 받지 않는다.
    expect(hostReport(current, { ...reported, version: 1 }, 'dashboard-1')).toBeNull()
    // 3. 명단을 바꾸는 보고는 받지 않는다.
    expect(hostReport(current, { ...reported, playerOrder: [P2, P1] }, 'dashboard-1')).toBeNull()
    expect(hostReport(current, { ...reported, playerOrder: [P1] }, 'dashboard-1')).toBeNull()
    // 4. 끝난 판은 다시 열리지 않는다.
    const finished = forfeit(current, P1, 2_000)
    expect(hostReport(finished, { ...reported, version: 99 }, 'dashboard-1')).toBeNull()
  })
})
