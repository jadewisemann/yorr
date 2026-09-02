import { describe, expect, it } from 'vitest'
import { P1, P2, pingPongState } from '@/pingpong/__tests__/pingPongFixtures'
import { playerNumberOf, toPingPongState } from '@/pingpong/domain/hostState'
import { createLocalGame } from '@/pingpong/domain/localGame'

const base = pingPongState()

const NOW = 1_753_000_000_000

describe('toPingPongState', () => {
  it('점수를 서버가 정한 playerOrder에 맞춰 싣는다', () => {
    const local = createLocalGame('duo', 'normal')
    local.s1 = 7
    local.s2 = 3

    const state = toPingPongState({ base, local, version: 10, now: NOW, countdownMs: 0 })

    expect(state.scores).toEqual({ [P1]: 7, [P2]: 3 })
    expect(state.playerOrder).toEqual([P1, P2])
  })

  it('서버가 만든 준비 정보는 그대로 물려받는다', () => {
    // 대시보드는 준비 게이트를 판정하지 않는다 — 이음매가 거기 있다(ADR-0003).
    const local = createLocalGame('duo', 'normal')

    const state = toPingPongState({ base, local, version: 10, now: NOW, countdownMs: 0 })

    expect(state.lastInputSeq).toEqual(base.lastInputSeq)
    expect(state.readyPlayerIds).toEqual(base.readyPlayerIds)
  })

  it('공의 launchedAt이 지금이라 받는 쪽이 같은 위치에서 이어 그린다', () => {
    const local = createLocalGame('duo', 'normal')
    local.ball.pos = 0.42

    const state = toPingPongState({ base, local, version: 10, now: NOW, countdownMs: 0 })

    expect(state.ball).toMatchObject({ pos: 0.42, launchedAt: NOW })
  })

  it('국면을 와이어 계약의 이름으로 옮긴다', () => {
    const local = createLocalGame('duo', 'normal')

    expect(toPingPongState({ base, local, version: 1, now: NOW, countdownMs: 0 }).phase).toBe(
      'PLAYING',
    )
    local.phase = 'point'
    expect(toPingPongState({ base, local, version: 2, now: NOW, countdownMs: 0 }).phase).toBe(
      'COUNTDOWN',
    )
    local.phase = 'over'
    expect(toPingPongState({ base, local, version: 3, now: NOW, countdownMs: 0 }).phase).toBe(
      'FINISHED',
    )
  })

  it('마감은 카운트다운 중일 때만 있다', () => {
    const local = createLocalGame('duo', 'normal')
    local.phase = 'point'

    const counting = toPingPongState({ base, local, version: 1, now: NOW, countdownMs: 2_600 })
    local.phase = 'playing'
    const playing = toPingPongState({ base, local, version: 2, now: NOW, countdownMs: 2_600 })

    expect(counting.nextActionAt).toBe(NOW + 2_600)
    expect(playing.nextActionAt).toBe(0)
  })

  it('지나간 카운트다운을 음수로 내보내지 않는다', () => {
    const local = createLocalGame('duo', 'normal')
    local.phase = 'point'

    const state = toPingPongState({ base, local, version: 1, now: NOW, countdownMs: -400 })

    expect(state.nextActionAt).toBe(NOW)
  })

  it('폴트를 와이어의 대문자 이름으로 옮긴다', () => {
    const local = createLocalGame('duo', 'normal')
    local.ball.fault = 'net'

    const state = toPingPongState({ base, local, version: 1, now: NOW, countdownMs: 0 })

    expect(state.ball.fault).toBe('NET')
  })
})

describe('playerNumberOf', () => {
  it('playerOrder의 자리가 로컬 번호를 정한다', () => {
    expect(playerNumberOf(base, P1)).toBe(1)
    expect(playerNumberOf(base, P2)).toBe(2)
  })

  it('명단에 없는 사람은 판정에 넣지 않는다', () => {
    // 대시보드 자신이나 이미 나간 사람의 스윙이 여기로 올 수 있다.
    expect(playerNumberOf(base, 'dashboard-1')).toBeNull()
  })
})
