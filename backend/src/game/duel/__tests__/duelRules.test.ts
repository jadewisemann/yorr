import { describe, expect, it } from 'vitest'
import {
  compareDraw,
  draw,
  expire,
  FOUL,
  finish,
  forfeit,
  hold,
  initialDuelState,
  KO_HOLD_MILLIS,
  MAX_FOULS,
  MAX_HP,
  MISS,
  nextRound,
  signal,
} from '../duelRules.js'
import type { DuelRound, DuelState } from '../duelState.js'

/**
 * 결투 규칙 12종 — **이 12개가 결투 규칙의 명세다.**
 */
const P1 = 'player-1'
const P2 = 'player-2'

const initial = (): DuelState => initialDuelState([P1, P2], 1_000, 2_000)

/** `lastRound`가 없는 프레임은 규칙 위반이다 — 테스트에서 옵셔널을 좁혀 쓴다. */
const lastRound = (state: DuelState): DuelRound => {
  const round = state.lastRound
  if (round === undefined) throw new Error('lastRound가 비어 있다')
  return round
}

describe('DuelRules', () => {
  it('더 빨리 뽑은 쪽이 상대를 쏜다', () => {
    const signalled = signal(initial(), 5_000)

    const first = draw(signalled, P1, 1, 180, 5_200)
    const resolved = draw(first, P2, 1, 240, 5_260)

    expect(resolved.phase).toBe('RESULT')
    expect(lastRound(resolved).kind).toBe('SHOT')
    expect(lastRound(resolved).shooterId).toBe(P1)
    expect(resolved.hp).toEqual({ [P1]: MAX_HP, [P2]: MAX_HP - 1 })
    expect(lastRound(resolved).over).toBe(false)
  })

  it('같은 밀리초는 무승부이고 아무도 총알을 잃지 않는다', () => {
    const signalled = signal(initial(), 5_000)

    const first = draw(signalled, P1, 1, 200, 5_220)
    const resolved = draw(first, P2, 1, 200, 5_230)

    expect(lastRound(resolved).kind).toBe('TIE')
    expect(lastRound(resolved).hitId).toBeNull()
    expect(resolved.hp).toEqual({ [P1]: MAX_HP, [P2]: MAX_HP })
  })

  /** 첫 부정출발은 상대를 무피해로 두고 경고만 남긴다 — 손떨림 한 번에 체력을 깎지 않는다. */
  it('첫 부정출발은 경고만 남긴다', () => {
    const fouled = draw(initial(), P1, 1, 120, 2_000)

    expect(lastRound(fouled).kind).toBe('WARNING')
    expect(lastRound(fouled).foulId).toBe(P1)
    expect(fouled.fouls[P1]).toBe(1)
    expect(fouled.hp).toEqual({ [P1]: MAX_HP, [P2]: MAX_HP })
  })

  /** 두 번째 부정출발은 총알이 남아 있어도 그 자리에서 결투를 끝낸다. */
  it('두 번째 부정출발은 즉시 결투를 잃는다', () => {
    const warned = nextRound(draw(initial(), P1, 1, -1, 2_000), 3_000, 1_500)

    const selfShot = draw(warned, P1, 2, -1, 3_400)

    expect(lastRound(selfShot).kind).toBe('SELF_SHOT')
    expect(lastRound(selfShot).hitId).toBe(P1)
    expect(lastRound(selfShot).koId).toBe(P1)
    expect(lastRound(selfShot).over).toBe(true)
    expect(selfShot.hp).toEqual({ [P1]: MAX_HP - 1, [P2]: MAX_HP })
    // 경고는 리셋되지 않는다 — 이 값이 곧 실격 사유다.
    expect(selfShot.fouls[P1]).toBe(MAX_FOULS)
    expect(hold(lastRound(selfShot))).toBe(KO_HOLD_MILLIS)
    expect(finish(selfShot).phase).toBe('FINISHED')
  })

  /** 경고는 라운드를 넘어 누적된다 — 라운드마다 두 번씩 기회를 주는 게 아니다. */
  it('경고는 라운드 간 누적된다', () => {
    const signalled = signal(initial(), 5_000)
    const fouled = draw(signalled, P1, 1, -1, 5_100)

    expect(lastRound(fouled).kind).toBe('WARNING')
    expect(fouled.fouls[P1]).toBe(1)

    const next = nextRound(fouled, 9_000, 1_500)

    expect(next.round).toBe(2)
    expect(next.fouls[P1]).toBe(1)
  })

  /** 신호 전 입력은 payload가 어떤 ms를 신고해도 부정출발이다 — 판정 권한은 서버에 있다. */
  it('신호 전 draw는 항상 부정출발이다', () => {
    const fouled = draw(initial(), P2, 1, 999, 2_000)

    expect(fouled.reactions[P2]).toBe(FOUL)
  })

  /** 서버에 흐른 시간보다 빠른 기록은 낼 수 없다 — 왕복 지연만큼은 클라이언트 편을 들어준다. */
  it('신고한 반응 시간은 서버 경과시간으로 깎인다', () => {
    const signalled = signal(initial(), 5_000)

    const drawn = draw(signalled, P1, 1, 900, 5_400)

    expect(drawn.reactions[P1]).toBe(400)
  })

  it('아무도 뽑지 않으면 라운드가 무효가 된다', () => {
    const signalled = signal(initial(), 5_000)

    const expired = expire(signalled, signalled.nextActionAt)

    expect(lastRound(expired).kind).toBe('TIE')
    expect(expired.reactions).toEqual({ [P1]: MISS, [P2]: MISS })
    expect(expired.hp).toEqual({ [P1]: MAX_HP, [P2]: MAX_HP })
  })

  /** 한쪽만 뽑고 유예가 끝나면 얼어붙은 쪽이 그대로 맞는다. */
  it('얼어붙은 쪽이 총알을 맞는다', () => {
    const signalled = signal(initial(), 5_000)
    const drawn = draw(signalled, P1, 1, 200, 5_200)

    const resolved = expire(drawn, drawn.nextActionAt)

    expect(lastRound(resolved).shooterId).toBe(P1)
    expect(resolved.hp[P2]).toBe(MAX_HP - 1)
  })

  it('세 번째 피격으로 결투가 끝나고 그다음 종료된다', () => {
    let state = initial()
    for (let round = 0; round < MAX_HP; round += 1) {
      const signalAt = 5_000 + round * 10_000
      state = signal(state, signalAt)
      state = draw(state, P1, round + 1, 180, signalAt + 200)
      state = draw(state, P2, round + 1, 300, signalAt + 320)
      if (!lastRound(state).over) state = nextRound(state, signalAt + 4_000, 1_500)
    }

    expect(state.hp[P2]).toBe(0)
    expect(lastRound(state).koId).toBe(P2)
    expect(lastRound(state).over).toBe(true)
    expect(state.phase).toBe('RESULT')
    expect(hold(lastRound(state))).toBe(KO_HOLD_MILLIS)

    const finished = finish(state)

    expect(finished.phase).toBe('FINISHED')
  })

  it('같은 입력 시퀀스는 무시된다', () => {
    const signalled = signal(initial(), 5_000)
    const drawn = draw(signalled, P1, 1, 200, 5_200)

    const repeated = draw(drawn, P1, 1, 100, 5_300)

    expect(repeated).toEqual(drawn)
  })

  it('이탈한 플레이어는 결투를 몰수당한다', () => {
    const finished = forfeit(initial(), P1, 2_000)

    expect(finished.phase).toBe('FINISHED')
    expect(finished.hp).toEqual({ [P1]: 0, [P2]: MAX_HP })
    expect(lastRound(finished).kind).toBe('FORFEIT')
    expect(lastRound(finished).shooterId).toBe(P2)
  })

  /**
   * 위 12종이 고정하지 못하는 비교 표(둘 다 실패·한쪽만 유효)를 직접 짚는다 —
   * `expire`·`draw` 경로가 전부 이 함수를 지나므로 회귀가 가장 먼저 여기서 드러난다.
   */
  it('compareDraw: 둘 다 실패면 무승부, 한쪽만 유효하면 그쪽이 이긴다', () => {
    expect(compareDraw(180, 240)).toBe(1)
    expect(compareDraw(240, 180)).toBe(2)
    expect(compareDraw(200, 200)).toBe(0)
    expect(compareDraw(200, MISS)).toBe(1)
    expect(compareDraw(FOUL, 200)).toBe(2)
    expect(compareDraw(MISS, MISS)).toBe(0)
    expect(compareDraw(FOUL, FOUL)).toBe(0)
  })
})
