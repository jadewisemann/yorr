import { describe, expect, it } from 'vitest'
import { DRAW_PENALTY_MS, drawOutcome, drawPenaltyMs } from '@/duel/domain/duel'
import { DUEL_FOUL, DUEL_MISS, type DuelRound, type DuelState } from '@/realtime/wsEvents'

/**
 * 입력 소스별 페널티. (S15P11A406-207)
 *
 * 밸런스 값 자체는 실기기에서 바뀌므로 숫자를 하드코딩해 검사하지 않는다 — 검사하는 것은
 * <b>규칙</b>이다: 스윙은 기준이고, 손가락 입력에만 얹히며, 센티넬은 건드리지 않는다.
 */
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

  /**
   * 페널티는 전송을 그만큼 늦춰서 걸린다. 서버 유예(GRACE_MILLIS=700)를 넘기면 기다리는
   * 동안 라운드가 끝나 뽑지 않은 것으로 기록되므로, 튜닝 폭이 여기 갇혀 있어야 한다.
   */
  it('페널티가 서버 유예(700ms)를 넘지 않는다', () => {
    for (const penalty of Object.values(DRAW_PENALTY_MS)) {
      expect(penalty).toBeLessThan(700)
    }
  })

  /** 부정출발(-1)에 100을 얹으면 99가 되어 가장 빠른 정상 기록으로 둔갑한다. */
  it('센티넬에는 페널티를 얹지 않는다', () => {
    expect(drawPenaltyMs(DUEL_FOUL, 'tap')).toBe(0)
    expect(drawPenaltyMs(DUEL_MISS, 'key')).toBe(0)
  })

  /** 0ms는 센티넬이 아니라 "신호와 같은 프레임에 뽑았다"다 — 정상 기록이므로 얹는다. */
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

/**
 * 폰이 읽는 한 줄. 큰 화면은 라운드를 이야기로 풀지만 폰은 <b>내게 무슨 일이 났는지</b>만
 * 한 단어로 안다 — 같은 라운드를 두 사람이 각자 자기 기준으로 다르게 읽어야 한다.
 */
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

  /** 경고·무승부는 체력이 안 깎였다 — 이겼다고도 졌다고도 말하지 않는다. */
  it('체력이 안 깎인 라운드는 승패로 읽지 않는다', () => {
    expect(drawOutcome(resultState({ foulId: ME, kind: 'WARNING' }), ME).tone).toBe('warn')
    expect(drawOutcome(resultState({ kind: 'TIE' }), ME).tone).toBe('warn')
  })

  /** 첫 라운드가 열리기 전에도 컨트롤러는 그려진다 — 빈 자리로 두면 문구가 undefined가 된다. */
  it('아직 판정이 없으면 대기로 읽는다', () => {
    const state = resultState({})
    state.lastRound = null

    expect(drawOutcome(state, ME).label).toBe('대기')
  })
})
