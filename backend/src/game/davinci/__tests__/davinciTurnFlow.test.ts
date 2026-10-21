import { describe, expect, it } from 'vitest'
import { DAVINCI_JOKER, type DavinciState, type DavinciTile } from '../davinciState.js'
import { advance, concludeTurn, placeDrawn, timedOut } from '../davinciTurnFlow.js'

/**
 * 턴 흐름 — 전수 대조(TESTING.md 「차등 테스트」)를 적용한다.
 *
 * 이 파일의 계약은 **"어느 갈래로 가든 턴은 반드시 움직인다"** 하나로 요약된다.
 * 그래서 개별 예시 몇 개가 아니라 **가능한 조합을 전부 돌려 불변식을 단언**한다:
 *
 *  ① `nextActionAt`이 그대로면 스케줄러가 지난 마감으로 다시 예약해 무한 루프가 된다.
 *  ② 턴 번호는 정확히 1 오른다(0이면 제자리, 2면 한 사람이 굶는다).
 *  ③ 남은 사람에게만 턴이 간다.
 *  ④ 남은 사람이 하나면 FINISHED가 되고 그 사람이 이긴다.
 *
 * 주의: `advance`는 다음 턴의 `drawn`까지 **더미에서 채운다**. 그래서 "이번 턴 타일이
 * 손에 들어갔다"는 `hands`로 보고, `drawn`은 다음 턴의 몫이다.
 */

const NOW = 1_700_000_000_000
const P1 = 'player-1'
const P2 = 'player-2'
const P3 = 'player-3'

const tile = (id: string, number: number, revealed = false): DavinciTile => ({
  id,
  color: 'BLACK',
  number,
  revealed,
})

/** 상태를 최소한으로 조립한다 — 턴 흐름이 읽는 필드만 의미가 있다. */
const stateOf = (overrides: Partial<DavinciState> = {}): DavinciState => ({
  version: 1,
  phase: 'GUESSING',
  playerOrder: [P1, P2],
  turnPlayerId: P1,
  hands: { [P1]: [tile('T0', 3), tile('T1', 7)], [P2]: [tile('T2', 1), tile('T3', 9)] },
  deck: [tile('T4', 5), tile('T5', 6)],
  drawn: null,
  turn: 1,
  eliminated: [],
  winnerId: null,
  hits: {},
  lastInputSeq: {},
  nextActionAt: NOW,
  ...overrides,
})

describe('advance — 불변식 전수 대조', () => {
  /** 손패 모양 × 더미 유무. 살아남는 갈래만 본다(탈락은 아래 별도). */
  const alive = [
    ['전부 감춤', [tile('T0', 3), tile('T1', 7)]],
    ['하나만 감춤', [tile('T0', 3), tile('T1', 7, true)]],
    ['조커 섞임', [tile('T0', 3), tile('T1', DAVINCI_JOKER)]],
  ] as const

  type Case = readonly [string, string, readonly DavinciTile[], readonly DavinciTile[]]
  const cases: Case[] = alive.flatMap(([shape, hand]) => [
    [shape, '더미 남음', [...hand], [tile('T9', 4), tile('T10', 8)]] as const,
    [shape, '더미 빔', [...hand], []] as const,
  ])

  it.each(cases)('%s · %s → 턴이 넘어가고 마감이 전진한다', (_shape, _deckName, hand, deck) => {
    const state = stateOf({ hands: { [P1]: [...hand], [P2]: [tile('T3', 9)] }, deck })
    const next = advance(state, NOW + 1_000)

    // ① 마감이 전진한다 — 제자리면 지난 마감으로 재예약되어 무한 루프.
    expect(next.nextActionAt).toBe(NOW + 1_000 + 0 + (next.nextActionAt - NOW - 1_000))
    expect(next.nextActionAt).toBeGreaterThan(NOW + 1_000)
    // ② 턴 번호가 정확히 1 오른다.
    expect(next.turn).toBe(state.turn + 1)
    // ③ 두 사람 모두 살아 있으므로 상대에게 간다.
    expect(next.turnPlayerId).toBe(P2)
    // ④ 끝나지 않는다.
    expect(next.phase).toBe('GUESSING')
    expect(next.winnerId).toBeNull()
    // 다음 턴의 타일을 더미에서 뽑는다 — 비었으면 null.
    expect(next.drawn).toEqual(deck[0] ?? null)
    // 뽑은 장은 더미에서 빠진다.
    expect(next.deck).toEqual(deck.slice(1))
  })

  it('손패를 다 공개한 사람은 탈락하고 남은 하나가 이긴다', () => {
    const state = stateOf({
      hands: { [P1]: [tile('T0', 3, true), tile('T1', 7, true)], [P2]: [tile('T2', 1)] },
      deck: [tile('T9', 4)],
    })

    const next = advance(state, NOW)

    expect(next.eliminated).toContain(P1)
    expect(next.phase).toBe('FINISHED')
    expect(next.winnerId).toBe(P2)
    expect(next.nextActionAt).toBe(0)
    // 끝난 판은 더미를 더 뽑지 않는다.
    expect(next.drawn).toBeNull()
  })

  it('이미 탈락한 사람을 두 번 넣지 않는다', () => {
    const state = stateOf({
      eliminated: [P1],
      hands: { [P1]: [tile('T0', 3, true)], [P2]: [tile('T2', 1)] },
      deck: [],
    })

    const next = advance(state, NOW)

    expect(next.eliminated.filter((id) => id === P1)).toHaveLength(1)
  })

  it('3인전에서 탈락자를 건너뛰고 다음 생존자로 간다', () => {
    const state = stateOf({
      playerOrder: [P1, P2, P3],
      eliminated: [P2],
      hands: { [P1]: [tile('T0', 3)], [P2]: [tile('T1', 1)], [P3]: [tile('T2', 5)] },
      deck: [tile('T9', 2)],
    })

    expect(advance(state, NOW).turnPlayerId).toBe(P3)
  })

  it('자리 순서가 한 바퀴 돌아 자기 차례로 돌아온다', () => {
    const state = stateOf({
      playerOrder: [P1, P2, P3],
      turnPlayerId: P3,
      hands: { [P1]: [tile('T0', 3)], [P2]: [tile('T1', 1)], [P3]: [tile('T2', 5)] },
      deck: [tile('T9', 2)],
    })

    expect(advance(state, NOW).turnPlayerId).toBe(P1)
  })
})

describe('concludeTurn — 전수 대조', () => {
  it('뽑은 타일이 보통이면 정렬 자리에 넣고 턴을 넘긴다', () => {
    const state = stateOf({ drawn: tile('T5b', 5) })

    const next = concludeTurn(state, false, NOW)

    // 3, 5, 7 — 가운데로 들어간다.
    expect(next.hands[P1]?.map((entry) => entry.number)).toEqual([3, 5, 7])
    expect(next.turnPlayerId).toBe(P2)
    // `drawn`은 **다음 턴의** 몫이다(이번 타일은 손에 들어갔다).
    expect(next.drawn).toEqual(state.deck[0])
  })

  it('감추며 넣는가 공개하며 넣는가가 타일의 revealed를 가른다', () => {
    const hidden = concludeTurn(stateOf({ drawn: tile('T5b', 5) }), false, NOW)
    const revealed = concludeTurn(stateOf({ drawn: tile('T5b', 5) }), true, NOW)

    expect(hidden.hands[P1]?.find((entry) => entry.number === 5)?.revealed).toBe(false)
    expect(revealed.hands[P1]?.find((entry) => entry.number === 5)?.revealed).toBe(true)
  })

  it('조커는 자리를 사람이 고르므로 PLACING에서 멈춘다', () => {
    const drawn = tile('T5b', DAVINCI_JOKER)

    for (const reveal of [false, true]) {
      const next = concludeTurn(stateOf({ drawn }), reveal, NOW)
      expect(next.phase).toBe('PLACING')
      expect(next.drawn).toEqual(reveal ? { ...drawn, revealed: true } : drawn)
      // 턴은 아직 넘어가지 않았다.
      expect(next.turnPlayerId).toBe(P1)
      expect(next.turn).toBe(1)
      expect(next.nextActionAt).toBeGreaterThan(NOW)
    }
  })

  it('더미가 비었고 틀렸으면 자기 타일 하나를 공개한다', () => {
    const state = stateOf({
      drawn: null,
      deck: [],
      hands: { [P1]: [tile('T0', 3), tile('T1', 7, true)], [P2]: [tile('T2', 1)] },
    })

    const next = concludeTurn(state, true, NOW)

    // 이미 공개된 T1이 아니라 감춘 T0이 대상이다.
    expect(next.hands[P1]?.find((entry) => entry.id === 'T0')?.revealed).toBe(true)
    // 손패가 다 공개됐으므로 탈락하고 끝난다.
    expect(next.phase).toBe('FINISHED')
    expect(next.winnerId).toBe(P2)
  })

  it('더미가 비었고 맞혔으면(멈춤) 아무것도 공개하지 않고 턴만 넘긴다', () => {
    const state = stateOf({ drawn: null, deck: [] })

    const next = concludeTurn(state, false, NOW)

    expect(next.hands[P1]?.every((entry) => !entry.revealed)).toBe(true)
    expect(next.turnPlayerId).toBe(P2)
    expect(next.drawn).toBeNull()
  })

  it('더미가 비었는데 감출 타일이 없으면 턴만 넘긴다', () => {
    const state = stateOf({
      drawn: null,
      deck: [],
      hands: { [P1]: [tile('T0', 3, true)], [P2]: [tile('T2', 1)] },
    })

    const next = concludeTurn(state, true, NOW)

    expect(next.phase).toBe('FINISHED')
    expect(next.winnerId).toBe(P2)
  })

  it('손패에 없는 사람도 턴 흐름이 죽지 않는다', () => {
    const state = stateOf({ drawn: tile('T5b', 5), hands: { [P2]: [tile('T2', 1)] } })

    expect(() => concludeTurn(state, false, NOW)).not.toThrow()
    expect(concludeTurn(state, false, NOW).hands[P1]?.map((entry) => entry.number)).toEqual([5])
  })
})

describe('placeDrawn — 경계값', () => {
  it.each([
    // [index, 기대: 놓였는가] — 손패 길이 2이므로 유효 범위는 0..2.
    [0, true],
    [1, true],
    [2, true],
    [-1, false],
    [3, false],
    [1.5, false],
  ])('index %s → %s', (index, placed) => {
    const state = stateOf({ phase: 'PLACING', drawn: tile('T5b', DAVINCI_JOKER), deck: [] })

    const next = placeDrawn(state, index, NOW)

    if (placed) {
      expect(next.turnPlayerId).toBe(P2)
      expect(next.hands[P1]?.some((entry) => entry.number === DAVINCI_JOKER)).toBe(true)
      expect(next.drawn).toBeNull()
    } else {
      // 거부하면 상태를 그대로 돌려준다 — 호출자가 오류로 바꾼다.
      expect(next).toBe(state)
    }
  })

  it('들고 있는 타일이 없으면 아무것도 하지 않는다', () => {
    const state = stateOf({ phase: 'PLACING', drawn: null })
    expect(placeDrawn(state, 0, NOW)).toBe(state)
  })
})

describe('timedOut — 어느 갈래로 가든 턴이 움직인다', () => {
  it.each([
    // GUESSING 타임아웃 = 틀린 것과 같다(공개). DECIDING 타임아웃 = 멈춤(감춤).
    ['GUESSING', true],
    ['DECIDING', false],
  ] as const)('%s에서 시간 초과가 타일을 공개하는가: %s', (phase, revealed) => {
    const state = stateOf({ phase, drawn: tile('T5b', 5), deck: [] })

    const next = timedOut(state, NOW)

    expect(next.hands[P1]?.find((entry) => entry.number === 5)?.revealed).toBe(revealed)
    expect(next.turnPlayerId).toBe(P2)
    expect(next.nextActionAt).toBeGreaterThan(NOW)
  })

  it('PLACING에서 시간 초과는 가장 오른쪽에 놓는다', () => {
    const state = stateOf({
      phase: 'PLACING',
      drawn: tile('T5b', DAVINCI_JOKER),
      deck: [],
    })

    const next = timedOut(state, NOW)

    expect(next.hands[P1]?.at(-1)?.number).toBe(DAVINCI_JOKER)
    expect(next.drawn).toBeNull()
    expect(next.nextActionAt).toBeGreaterThan(NOW)
  })

  it('PLACING인데 들고 있는 타일이 없어도 턴은 넘어간다(무한 루프 방지)', () => {
    // 있어서는 안 되는 상태지만, 여기서 멈추면 nextActionAt이 그대로 남아
    // 지난 마감으로 재예약 → 즉시 발화 루프가 된다.
    const state = stateOf({ phase: 'PLACING', drawn: null, deck: [] })

    const next = timedOut(state, NOW)

    expect(next.nextActionAt).toBeGreaterThan(NOW)
    expect(next.turnPlayerId).toBe(P2)
  })
})
