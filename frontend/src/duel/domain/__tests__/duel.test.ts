import { describe, expect, it } from 'vitest'
import {
  DRAW_PENALTY_MS,
  drawOutcome,
  drawPenaltyMs,
  duelOutcome,
  impactDelayMs,
  msLabel,
} from '@/duel/domain/duel'
import { DUEL_FOUL, DUEL_MISS, type DuelRound, type DuelState } from '@/realtime/wsEvents'

describe('drawPenaltyMs', () => {
  it('스윙이 기준이다 — 페널티가 없다', () => {
    expect(drawPenaltyMs(180, 'swing')).toBe(0)
  })

  it('탭·키보드에는 페널티를 얹는다', () => {
    expect(drawPenaltyMs(180, 'tap')).toBe(DRAW_PENALTY_MS.tap)
    expect(drawPenaltyMs(180, 'key')).toBe(DRAW_PENALTY_MS.key)
  })

  it('손가락 입력은 스윙보다 불리하다 — 밸런스 값을 어떻게 튜닝해도', () => {
    expect(DRAW_PENALTY_MS.tap).toBeGreaterThan(DRAW_PENALTY_MS.swing)
    expect(DRAW_PENALTY_MS.key).toBeGreaterThan(DRAW_PENALTY_MS.swing)
  })

  it('페널티가 서버 유예(700ms)를 넘지 않는다', () => {
    for (const penalty of Object.values(DRAW_PENALTY_MS)) {
      expect(penalty).toBeLessThan(700)
    }
  })

  it('센티넬에는 페널티를 얹지 않는다', () => {
    expect(drawPenaltyMs(DUEL_FOUL, 'tap')).toBe(0)
    expect(drawPenaltyMs(DUEL_MISS, 'key')).toBe(0)
  })

  it('0ms도 정상 기록이라 페널티가 얹힌다', () => {
    expect(drawPenaltyMs(0, 'tap')).toBe(DRAW_PENALTY_MS.tap)
  })
})

const ME = 'me'
const RIVAL = 'rival'

function resultState(round: Partial<DuelRound>): DuelState {
  return {
    fouls: {},
    hp: {},
    lastInputSeq: {},
    lastRound: { at: 0, kind: 'SHOT', number: 1, over: false, ...round },
    nextActionAt: 0,
    phase: 'RESULT',
    playerOrder: [ME, RIVAL],
    reactions: {},
    round: 1,
    signalAt: 0,
    version: 1,
  }
}

describe('drawOutcome', () => {
  it('쏜 쪽과 맞은 쪽이 같은 라운드를 다르게 읽는다', () => {
    const state = resultState({ hitId: RIVAL, shooterId: ME })

    expect(drawOutcome(state, ME)).toEqual({ label: '명중!', tone: 'win' })
    expect(drawOutcome(state, RIVAL)).toEqual({ label: '맞았다', tone: 'lose' })
  })

  it('자기 발을 쏜 쪽만 자기 잘못으로 읽는다', () => {
    const state = resultState({ foulId: RIVAL, hitId: RIVAL, kind: 'SELF_SHOT' })

    expect(drawOutcome(state, RIVAL).tone).toBe('lose')
    expect(drawOutcome(state, ME).tone).toBe('win')
  })

  it('체력이 안 깎인 라운드는 승패로 읽지 않는다', () => {
    expect(drawOutcome(resultState({ foulId: ME, kind: 'WARNING' }), ME).tone).toBe('warn')
    expect(drawOutcome(resultState({ kind: 'TIE' }), ME).tone).toBe('warn')
  })

  it('아직 판정이 없으면 대기로 읽는다', () => {
    const state = resultState({})
    state.lastRound = null

    expect(drawOutcome(state, ME).label).toBe('대기')
  })
})

describe('impactDelayMs', () => {
  it('내 총알이면 이미 날아간 만큼을 깎는다', () => {
    expect(impactDelayMs(300, 120)).toBe(180)
  })

  it('남의 총알이면(날아간 시간 0) 비행 시간 그대로다', () => {
    expect(impactDelayMs(300, 0)).toBe(300)
  })

  it('판정이 비행 시간보다 늦게 오면 즉시 착탄이다 — 음수로 내려가지 않는다', () => {
    expect(impactDelayMs(300, 900)).toBe(0)
  })
})

describe('duelOutcome', () => {
  const base = { myHp: 2, opponentHp: 2, you: 'me' }

  it('쓰러진 사람이 진 사람이다 — 총알이 남아 있어도(부정출발 실격) 진다', () => {
    expect(duelOutcome({ ...base, fallenId: 'me', myHp: 3, opponentHp: 1 })).toBe('lost')
    expect(duelOutcome({ ...base, fallenId: 'you', myHp: 1, opponentHp: 3 })).toBe('won')
  })

  it('쓰러진 사람이 없고 총알이 같으면 무승부다', () => {
    expect(duelOutcome({ ...base, fallenId: undefined })).toBe('draw')
  })

  it('쓰러진 사람이 없으면 남은 총알로 가른다', () => {
    expect(duelOutcome({ ...base, fallenId: undefined, myHp: 3, opponentHp: 1 })).toBe('won')
    expect(duelOutcome({ ...base, fallenId: undefined, myHp: 1, opponentHp: 3 })).toBe('lost')
  })
})

describe('결과 문구', () => {
  const state = (round: DuelState['lastRound']): DuelState =>
    ({ lastRound: round }) as unknown as DuelState

  it('상대가 떠난 라운드는 남은 사람의 승리로 읽힌다', () => {
    expect(drawOutcome(state({ kind: 'FORFEIT' } as DuelRound), 'me')).toEqual({
      label: '상대가 떠났다',
      tone: 'win',
    })
  })

  it('반칙과 얼어붙음은 시간 대신 이유를 보여 준다', () => {
    expect(msLabel(DUEL_FOUL)).toBe('성급했다')
    expect(msLabel(null)).toBe('얼어붙음')
    expect(msLabel(231)).toBe('231ms')
  })
})
