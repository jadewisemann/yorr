import { describe, expect, it } from 'vitest'
import {
  GUESSABLE_NUMBERS,
  hiddenCount,
  lastEventMessage,
  opponentsOf,
  promptOf,
  scoreOf,
  tileLabel,
} from '@/davinci/domain/davinci'
import { DAVINCI_JOKER, type DavinciTile, type DavinciView } from '@/realtime/wsEvents'

const ME = 'me'
const RIVAL = 'rival'
const THIRD = 'third'

const tile = (overrides: Partial<DavinciTile> = {}): DavinciTile => ({
  id: 'T0',
  color: 'BLACK',
  number: null,
  revealed: false,
  ...overrides,
})

const view = (overrides: Partial<DavinciView> = {}): DavinciView => ({
  deckCount: 10,
  eliminated: [],
  hands: {
    [ME]: [tile({ id: 'M0', number: 2 }), tile({ id: 'M1', number: 7 })],
    [RIVAL]: [tile({ id: 'R0' }), tile({ id: 'R1', number: 4, revealed: true })],
  },
  hits: {},
  lastInputSeq: {},
  nextActionAt: 0,
  phase: 'GUESSING',
  playerOrder: [ME, RIVAL],
  turn: 1,
  turnPlayerId: ME,
  version: 1,
  ...overrides,
})

const nameOf = (playerId: string): string => (playerId === ME ? '나' : '상대')

describe('타일 표기', () => {
  it('감춘 타일은 물음표, 조커는 J로 적는다', () => {
    expect(tileLabel({ number: null })).toBe('?')
    expect(tileLabel({ number: DAVINCI_JOKER })).toBe('J')
    expect(tileLabel({ number: 0 })).toBe('0')
  })

  it('부를 수 있는 숫자는 0~11과 조커 열셋이다', () => {
    expect(GUESSABLE_NUMBERS).toHaveLength(13)
    expect(GUESSABLE_NUMBERS.at(-1)).toBe(DAVINCI_JOKER)
  })
})

describe('지금 무엇을 해야 하는가', () => {
  it('내 차례의 단계가 그대로 화면의 요구가 된다', () => {
    expect(promptOf(view(), ME)).toBe('guess')
    expect(promptOf(view({ phase: 'DECIDING' }), ME)).toBe('decide')
    expect(promptOf(view({ phase: 'PLACING' }), ME)).toBe('place')
  })

  it('남의 차례거나 탈락했거나 끝났으면 기다린다', () => {
    expect(promptOf(view(), RIVAL)).toBe('wait')
    expect(promptOf(view({ eliminated: [ME] }), ME)).toBe('eliminated')
    expect(promptOf(view({ phase: 'FINISHED' }), ME)).toBe('finished')
    expect(promptOf(undefined, ME)).toBe('loading')
  })

  it('탈락한 상대는 지목 대상에서 빠진다', () => {
    const three = view({ eliminated: [THIRD], playerOrder: [ME, RIVAL, THIRD] })

    expect(opponentsOf(three, ME)).toEqual([RIVAL])
  })
})

describe('점수', () => {
  it('맞힌 수와 끝까지 감춘 수를 더한다', () => {
    const finished = view({ hits: { [ME]: 3 }, phase: 'FINISHED' })

    expect(hiddenCount(finished, ME)).toBe(2)
    expect(scoreOf(finished, ME)).toBe(5)
    expect(scoreOf(finished, RIVAL)).toBe(1)
  })
})

describe('직전에 일어난 일', () => {
  it('맞혔는지 틀렸는지를 문장으로 알린다', () => {
    const hit = view({
      lastEvent: {
        actorId: ME,
        at: 1,
        correct: true,
        kind: 'GUESS',
        number: 4,
        targetId: RIVAL,
        tileId: 'R1',
      },
    })

    expect(lastEventMessage(hit, nameOf)).toBe('나 님이 상대의 4을(를) 맞혔어요.')
  })

  it('조커는 숫자가 아니라 조커라고 적는다', () => {
    const miss = view({
      lastEvent: {
        actorId: RIVAL,
        at: 1,
        correct: false,
        kind: 'GUESS',
        number: DAVINCI_JOKER,
        targetId: ME,
        tileId: 'M0',
      },
    })

    expect(lastEventMessage(miss, nameOf)).toBe('상대 님이 나에게 조커을(를) 불렀지만 틀렸어요.')
  })

  it('시간 초과와 이탈은 추측과 다른 문장이다', () => {
    const timeout = view({
      lastEvent: { actorId: RIVAL, at: 1, correct: false, kind: 'TIMEOUT' },
    })
    const forfeit = view({
      lastEvent: { actorId: RIVAL, at: 1, correct: false, kind: 'FORFEIT' },
    })

    expect(lastEventMessage(timeout, nameOf)).toContain('시간을 넘겼')
    expect(lastEventMessage(forfeit, nameOf)).toContain('판을 떠났')
    expect(lastEventMessage(view(), nameOf)).toBeNull()
  })
})
