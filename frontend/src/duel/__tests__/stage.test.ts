import { describe, expect, it } from 'vitest'
import type { DuelRound, DuelState } from '@/realtime/wsEvents'
import type { ShotTarget } from '../duel'
import { buildStage } from '../stage'

const ME = 'me'
const RIVAL = 'rival'

function duelState(overrides: Partial<DuelState> = {}): DuelState {
  return {
    fouls: { [ME]: 0, [RIVAL]: 0 },
    hp: { [ME]: 3, [RIVAL]: 3 },
    lastInputSeq: { [ME]: -1, [RIVAL]: -1 },
    nextActionAt: 0,
    phase: 'WAITING',
    playerOrder: [ME, RIVAL],
    reactions: {},
    round: 1,
    signalAt: 0,
    version: 1,
    ...overrides,
  }
}

function round(overrides: Partial<DuelRound> = {}): DuelRound {
  return { at: 0, kind: 'SHOT', number: 1, over: false, ...overrides }
}

function stage(overrides: Partial<DuelState>, youShot: ShotTarget | null = null) {
  return buildStage({
    opponentId: RIVAL,
    opponentName: '상대',
    state: duelState(overrides),
    you: ME,
    youShot,
  })
}

describe('buildStage', () => {
  it('나를 항상 왼쪽에 둔다 — 두 사람이 각자 자기를 왼쪽에 두고 같은 결투를 본다', () => {
    const view = stage({})

    expect(view.left.name).toBe('나')
    expect(view.right.name).toBe('상대')
  })

  /** 서버 왕복(유예 최대 700ms)을 기다리면 누른 순간 아무 일도 안 일어난 것처럼 보인다. */
  it('누른 순간 서버 응답 없이 총이 나간다', () => {
    const signal = { phase: 'SIGNAL' as const, signalAt: 1_000 }

    expect(stage(signal).leftShot).toBeNull()
    expect(stage(signal).left.pose).toBe('ready')

    const fired = stage(signal, 'opponent')

    expect(fired.leftShot).toBe('opponent')
    expect(fired.left.pose).toBe('draw')
    // 내 총만 나간다 — 상대가 뽑았는지는 판정 전에 밝히지 않는다.
    expect(fired.rightShot).toBeNull()
  })

  /** 신호 전에 당긴 총알은 상대가 아니라 자기 발밑에 박힌다. */
  it('신호 전에 당기면 총알이 발밑으로 간다', () => {
    const view = stage({}, 'ground')

    expect(view.leftShot).toBe('ground')
    expect(view.left.pose).toBe('draw')
  })

  /** 총알이 날아가는 시간을 두지 않으므로 판정과 피격이 한 프레임에 붙는다. */
  it('판정이 오는 즉시 맞은 자세와 체력이 함께 반영된다', () => {
    const view = stage({
      hp: { [ME]: 3, [RIVAL]: 2 },
      lastRound: round({ hitId: RIVAL, shooterId: ME }),
      phase: 'RESULT',
      reactions: { [ME]: 180, [RIVAL]: 240 },
    })

    expect(view.winner).toBe(1)
    expect(view.left.pose).toBe('draw')
    expect(view.right.pose).toBe('hit')
    expect(view.right.hp).toBe(2)
  })

  it('체력이 0이 된 쪽은 쓰러진다', () => {
    const view = stage({
      hp: { [ME]: 3, [RIVAL]: 0 },
      lastRound: round({ hitId: RIVAL, koId: RIVAL, over: true, shooterId: ME }),
      phase: 'RESULT',
      reactions: { [ME]: 180, [RIVAL]: 240 },
    })

    expect(view.right.pose).toBe('dead')
    expect(view.ko).toBe(true)
  })

  /** 부정출발은 상대에게 총알이 가지 않는다 — 상대는 총을 뽑지도 않았다. */
  it('부정출발 라운드에서는 성급했던 쪽만 총을 들고 있다', () => {
    const view = stage({
      fouls: { [ME]: 1, [RIVAL]: 0 },
      lastRound: round({ foulId: ME, kind: 'WARNING' }),
      phase: 'RESULT',
      reactions: { [ME]: -1 },
    })

    expect(view.foulSide).toBe(1)
    expect(view.leftShot).toBe('ground')
    expect(view.rightShot).toBeNull()
    expect(view.left.pose).toBe('draw')
    expect(view.right.pose).toBe('ready')
    expect(view.left.fouls).toBe(1)
  })

  it('경고가 차면 자기 발을 쏘고 본인이 젖혀진다', () => {
    const view = stage({
      fouls: { [ME]: 2, [RIVAL]: 0 },
      hp: { [ME]: 2, [RIVAL]: 3 },
      lastRound: round({ foulId: ME, hitId: ME, koId: ME, kind: 'SELF_SHOT', over: true }),
      phase: 'RESULT',
      reactions: { [ME]: -1 },
    })

    expect(view.selfShot).toBe(true)
    // 실격은 총알이 남은 채로 진다 — 쓰러진 사람이 진 사람이다.
    expect(view.left.pose).toBe('dead')
    expect(view.left.hp).toBe(2)
    expect(view.ko).toBe(true)
  })

  it('내가 뽑고 상대를 기다리는 동안에는 내 기록만 보여준다', () => {
    const view = stage({ phase: 'SIGNAL', reactions: { [ME]: 182 }, signalAt: 1_000 })

    expect(view.pending).toBe(true)
    expect(view.phase).toBe('result')
    expect(view.left.ms).toBe(182)
    expect(view.right.ms).toBeNull()
  })

  /** 판정 전에 상대 기록이 새면 승부가 김이 샌다. */
  it('상대가 먼저 뽑아도 판정 전에는 상대 기록을 밝히지 않는다', () => {
    const view = stage({ phase: 'SIGNAL', reactions: { [RIVAL]: 150 }, signalAt: 1_000 })

    expect(view.pending).toBe(false)
    expect(view.phase).toBe('signal')
    expect(view.right.ms).toBeNull()
  })

  it('얼어붙어 못 뽑은 쪽은 홀스터에 손을 얹은 채로 맞는다', () => {
    const view = stage({
      hp: { [ME]: 2, [RIVAL]: 3 },
      lastRound: round({ hitId: ME, shooterId: RIVAL }),
      phase: 'RESULT',
      reactions: { [ME]: -2, [RIVAL]: 190 },
    })

    expect(view.leftShot).toBeNull()
    expect(view.left.pose).toBe('hit')
  })

  it('TIE는 둘 다 총을 뽑은 채로 체력이 그대로다', () => {
    const view = stage({
      lastRound: round({ kind: 'TIE' }),
      phase: 'RESULT',
      reactions: { [ME]: 200, [RIVAL]: 200 },
    })

    expect(view.tie).toBe(true)
    expect(view.winner).toBe(0)
    expect(view.left.pose).toBe('draw')
    expect(view.right.pose).toBe('draw')
    expect(view.left.hp).toBe(3)
    expect(view.right.hp).toBe(3)
  })
})
