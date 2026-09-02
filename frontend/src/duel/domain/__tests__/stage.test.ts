import { describe, expect, it } from 'vitest'
import type { ShotTarget } from '@/duel/domain/duel'
import { buildStage } from '@/duel/domain/stage'
import type { DuelRound, DuelState } from '@/realtime/wsEvents'

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

function stage(overrides: Partial<DuelState>, impact = false, youShot: ShotTarget | null = null) {
  return buildStage({
    impact,
    opponentId: RIVAL,
    opponentName: '상대',
    state: duelState(overrides),
    you: ME,
    youName: '나',
    youShot,
  })
}

describe('buildStage', () => {
  it('나를 항상 왼쪽에 둔다 — 두 사람이 각자 자기를 왼쪽에 두고 같은 결투를 본다', () => {
    const view = stage({})

    expect(view.left.name).toBe('나')
    expect(view.right.name).toBe('상대')
  })

  it('관전 화면은 왼쪽도 닉네임으로 부른다', () => {
    const view = buildStage({
      impact: false,
      opponentId: RIVAL,
      opponentName: '두번째',
      state: duelState({}),
      you: ME,
      youName: '첫번째',
      youShot: null,
    })

    expect(view.left.name).toBe('첫번째')
    expect(view.right.name).toBe('두번째')
  })

  /** 내가 부정출발한 판정 화면. 총알이 상대에게 가지 않는 갈래를 본다. */
  const foulState = {
    fouls: { [ME]: 1, [RIVAL]: 0 },
    lastRound: round({ foulId: ME, kind: 'WARNING' as const }),
    phase: 'RESULT' as const,
    reactions: { [ME]: -1 },
  }

  /** 내가 쏴서 상대가 맞은 판정 화면. 총알이 닿기 전후를 함께 본다. */
  const shot = {
    hp: { [ME]: 3, [RIVAL]: 2 },
    lastRound: round({ hitId: RIVAL, shooterId: ME }),
    phase: 'RESULT' as const,
  }

  it('총알이 닿기 전에는 맞은 쪽 체력이 아직 깎이지 않는다', () => {
    expect(stage(shot).right.hp).toBe(3)
    expect(stage(shot, true).right.hp).toBe(2)
  })

  it('맞은 쪽은 총알이 닿은 뒤에 젖혀진다', () => {
    expect(stage(shot).right.pose).toBe('ready')
    expect(stage(shot, true).right.pose).toBe('hit')
    expect(stage(shot, true).left.pose).toBe('draw')
    expect(stage(shot, true).winner).toBe(1)
  })

  it('체력이 0이 된 쪽은 쓰러진다', () => {
    const knockout = {
      hp: { [ME]: 3, [RIVAL]: 0 },
      lastRound: round({ hitId: RIVAL, koId: RIVAL, over: true, shooterId: ME }),
      phase: 'RESULT' as const,
    }

    const view = stage(knockout, true)

    expect(view.right.pose).toBe('dead')
    expect(view.ko).toBe(true)
  })

  it('부정출발 라운드에서는 성급했던 쪽만 총을 들고 있다', () => {
    const view = stage({
      fouls: { [ME]: 1, [RIVAL]: 0 },
      lastRound: round({ foulId: ME, kind: 'WARNING' }),
      phase: 'RESULT',
    })

    expect(view.foulSide).toBe(1)
    expect(view.left.pose).toBe('draw')
    expect(view.right.pose).toBe('ready')
    expect(view.left.fouls).toBe(1)
  })

  it('경고가 차면 자기 발을 쏘고 본인이 젖혀진다', () => {
    const view = stage(
      {
        hp: { [ME]: 2, [RIVAL]: 3 },
        lastRound: round({ foulId: ME, hitId: ME, kind: 'SELF_SHOT' }),
        phase: 'RESULT',
      },
      true,
    )

    expect(view.selfShot).toBe(true)
    expect(view.left.pose).toBe('hit')
    expect(view.left.hp).toBe(2)
  })

  it('반응한 순간 총알이 서버 응답 없이 떠난다', () => {
    const signal = { phase: 'SIGNAL' as const, signalAt: 1_000 }

    expect(stage(signal).leftShot).toBeNull()
    expect(stage(signal).left.pose).toBe('ready')

    const fired = stage(signal, false, 'opponent')

    expect(fired.leftShot).toBe('opponent')
    expect(fired.left.pose).toBe('draw')
    expect(fired.rightShot).toBeNull()
  })

  it('신호 전에 당기면 총알이 발밑으로 간다', () => {
    const view = stage({}, false, 'ground')

    expect(view.leftShot).toBe('ground')
    expect(view.left.pose).toBe('draw')
  })

  it('진 쪽도 총알이 닿기 전까지는 겨눈 자세를 유지한다', () => {
    const slower = {
      hp: { [ME]: 2, [RIVAL]: 3 },
      lastRound: round({ hitId: ME, shooterId: RIVAL }),
      phase: 'RESULT' as const,
      reactions: { [ME]: 320, [RIVAL]: 190 },
    }

    expect(stage(slower).left.pose).toBe('draw')
    expect(stage(slower, true).left.pose).toBe('hit')
  })

  it('얼어붙어 못 뽑은 쪽은 끝까지 홀스터에 손을 얹고 있다', () => {
    const frozen = {
      hp: { [ME]: 2, [RIVAL]: 3 },
      lastRound: round({ hitId: ME, shooterId: RIVAL }),
      phase: 'RESULT' as const,
      reactions: { [ME]: -2, [RIVAL]: 190 },
    }

    expect(stage(frozen).left.pose).toBe('ready')
    expect(stage(frozen, true).left.pose).toBe('hit')
  })

  it('느렸던 쪽 총알은 빗나가고 한마디가 붙는다', () => {
    const view = stage(
      {
        hp: { [ME]: 3, [RIVAL]: 2 },
        lastRound: round({ hitId: RIVAL, number: 3, shooterId: ME }),
        phase: 'RESULT',
        reactions: { [ME]: 180, [RIVAL]: 240 },
      },
      false,
      'opponent',
    )

    expect(view.winner).toBe(1)
    expect(view.leftMiss).toBe(false)
    expect(view.rightMiss).toBe(true)
    expect(view.miss?.side).toBe(1)
    expect(view.miss?.taunt).toBeTruthy()
  })

  it('같은 라운드는 몇 번을 다시 그려도 같은 한마디가 나온다', () => {
    const shot = {
      hp: { [ME]: 3, [RIVAL]: 2 },
      lastRound: round({ hitId: RIVAL, number: 3, shooterId: ME }),
      phase: 'RESULT' as const,
      reactions: { [ME]: 180, [RIVAL]: 240 },
    }

    expect(stage(shot).miss?.taunt).toBe(stage(shot).miss?.taunt)
  })

  it('얼어붙어 못 뽑은 쪽에는 빗나감이 없다', () => {
    const view = stage({
      hp: { [ME]: 2, [RIVAL]: 3 },
      lastRound: round({ hitId: ME, shooterId: RIVAL }),
      phase: 'RESULT',
      reactions: { [ME]: -2, [RIVAL]: 190 },
    })

    expect(view.leftShot).toBeNull()
    expect(view.leftMiss).toBe(false)
    expect(view.miss).toBeNull()
  })

  it('부정출발 라운드에는 빗나감이 없다 — 서로를 겨누지 않았다', () => {
    const view = stage(foulState)

    expect(view.leftMiss).toBe(false)
    expect(view.rightMiss).toBe(false)
    expect(view.miss).toBeNull()
  })

  it('내가 뽑고 상대를 기다리는 동안에는 내 기록만 보여준다', () => {
    const view = stage({ phase: 'SIGNAL', reactions: { [ME]: 182 }, signalAt: 1_000 })

    expect(view.pending).toBe(true)
    expect(view.phase).toBe('result')
    expect(view.left.ms).toBe(182)
    expect(view.right.ms).toBeNull()
  })

  it('상대가 먼저 뽑아도 판정 전에는 상대 기록을 밝히지 않는다', () => {
    const view = stage({ phase: 'SIGNAL', reactions: { [RIVAL]: 150 }, signalAt: 1_000 })

    expect(view.pending).toBe(false)
    expect(view.phase).toBe('signal')
    expect(view.right.ms).toBeNull()
  })

  it('TIE는 둘 다 총을 뽑은 채로 체력이 그대로다', () => {
    const view = stage(
      {
        lastRound: round({ kind: 'TIE' }),
        phase: 'RESULT',
        reactions: { [ME]: 200, [RIVAL]: 200 },
      },
      true,
    )

    expect(view.tie).toBe(true)
    expect(view.winner).toBe(0)
    expect(view.left.pose).toBe('draw')
    expect(view.right.pose).toBe('draw')
    expect(view.left.hp).toBe(3)
    expect(view.right.hp).toBe(3)
    expect(view.clash).toBe(true)
  })

  it('부정출발 라운드는 총알이 상대에게 가지 않는다', () => {
    const view = stage(foulState)

    expect(view.leftShot).toBe('ground')
    expect(view.rightShot).toBeNull()
    expect(view.clash).toBe(false)
  })
})
