import { describe, expect, it } from 'vitest'
import {
  expire,
  forfeit,
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
})
