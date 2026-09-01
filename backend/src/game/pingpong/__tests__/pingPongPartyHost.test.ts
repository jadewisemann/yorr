import { beforeEach, describe, expect, it } from 'vitest'
import { initial } from '../pingPongRules.js'
import type { PingPongState } from '../pingPongState.js'
import { type Harness, harness, P1, P2, ROOM, startResult } from './pingPongHarness.js'

describe('PingPongGameService (파티 모드 호스트 판정)', () => {
  const DASHBOARD = 'dashboard-1'
  let test: Harness

  beforeEach(() => {
    test = harness({ party: true })
  })

  const playing = (over: Partial<PingPongState> = {}): PingPongState => ({
    ...initial([P1, P2], 1_000),
    phase: 'PLAYING',
    nextActionAt: 9_000,
    ...over,
  })

  it('파티 방에서 게임을 시작하면 마감 예약을 걸지 않는다', async () => {
    // 걸어 두면 서버가 자기 시뮬레이션으로 점수를 내고 game.over까지 만든다.
    await test.service.start(ROOM, startResult(P1))

    expect(test.calls.filter((call) => call.startsWith('scheduler.schedule'))).toEqual([])
  })

  it('스윙을 판정하지 않고 대시보드에게 넘긴다', async () => {
    test.states.state = playing()
    const before = test.states.state.version
    test.broadcasts.length = 0

    await test.service.swing(ROOM, P1, { inputSeq: 1, clientTs: 1_000 })

    expect(test.broadcasts.map((message) => message.type)).toEqual(['game.ping_pong.swung'])
    expect(test.broadcasts[0]?.payload).toMatchObject({ playerId: P1, inputSeq: 1 })
    // 상태는 그대로여야 한다 — 판정은 대시보드 몫이다.
    expect(test.states.state?.version).toBe(before)
  })

  it('대시보드가 보고한 상태를 그대로 받아 방송한다', async () => {
    test.states.state = playing()
    test.broadcasts.length = 0

    await test.service.hostState(ROOM, DASHBOARD, playing({ version: 99, rally: 7 }))

    expect(test.states.state?.rally).toBe(7)
    expect(test.broadcasts.map((message) => message.type)).toEqual(['game.ping_pong.state'])
  })

  it('플레이어가 보낸 보고는 무시한다', async () => {
    test.states.state = playing()

    await test.service.hostState(ROOM, P1, playing({ version: 99, scores: { [P1]: 11, [P2]: 0 } }))

    // 자기 점수를 올리는 통로가 되면 안 된다.
    expect(test.states.state?.scores[P1]).toBe(0)
  })

  it('version이 되돌아가는 보고는 무시한다', async () => {
    test.states.state = playing({ version: 50 })

    await test.service.hostState(ROOM, DASHBOARD, playing({ version: 49, rally: 3 }))

    expect(test.states.state?.rally).toBe(0)
  })

  it('roster를 바꾸는 보고는 무시한다', async () => {
    test.states.state = playing()

    await test.service.hostState(
      ROOM,
      DASHBOARD,
      playing({ version: 99, playerOrder: [P1, 'stranger'] }),
    )

    expect(test.states.state?.version).toBe(playing().version)
  })

  it('FINISHED 보고는 서버가 점수를 쓰고 완료 경로를 탄다', async () => {
    test.states.state = playing()
    test.calls.length = 0

    await test.service.hostState(
      ROOM,
      DASHBOARD,
      playing({ version: 99, phase: 'FINISHED', scores: { [P1]: 11, [P2]: 8 } }),
    )

    // 점수를 종료 판정보다 먼저 써야 game.over의 순위가 최종 점수를 본다.
    expect(test.calls.filter((call) => !call.startsWith('broadcast'))).toEqual([
      'scheduler.cancelRoom',
      'scoreWriter.record',
      'completion.finishIfComplete(true)',
    ])
    expect(test.scores).toEqual({ [P1]: 11, [P2]: 8 })
  })

  it('파티 방이 아니면 보고를 받지 않는다', async () => {
    const normal = harness()
    normal.states.state = { ...initial([P1, P2], 1_000), phase: 'PLAYING' }

    await normal.service.hostState(ROOM, DASHBOARD, playing({ version: 99, rally: 7 }))

    expect(normal.states.state?.rally).toBe(0)
  })
})
