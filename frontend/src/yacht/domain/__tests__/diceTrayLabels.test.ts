import { describe, expect, it } from 'vitest'
import { createDiceSet, NO_HELD_DICE } from '@/yacht/domain/dice'
import {
  diceTrayLabel,
  diceTrayStatus,
  keepRailState,
  keptRailLabel,
} from '@/yacht/domain/diceTrayLabels'
import type { GamePlayRoll } from '@/yacht/model/useGamePlayRoll'

const local = (overrides: Partial<GamePlayRoll['local']> = {}): GamePlayRoll['local'] =>
  ({
    dice: createDiceSet([6, 5, 4, 3, 2]),
    held: NO_HELD_DICE,
    ...overrides,
  }) as GamePlayRoll['local']

/**
 * 주사위 트레이의 안내 문구. 사람이 다음에 무엇을 해야 하는지가 여기서만 나온다 —
 * 조건 하나가 새면 "굴릴 수 없는데 굴리라고 말하는" 화면이 된다.
 */
describe('diceTrayLabel', () => {
  it('턴 주인을 모르면 동기화 중이라고 말한다', () => {
    expect(
      diceTrayLabel({ activePlayerName: undefined, currentRollNumber: 1, isMyTurn: true }),
    ).toBe('턴 동기화 중')
  })

  it('내 턴에는 굴림 수를, 남의 턴에는 그 사람 이름을 보여 준다', () => {
    expect(diceTrayLabel({ activePlayerName: '나', currentRollNumber: 2, isMyTurn: true })).toBe(
      '롤링 존 · 나 · 굴림 2/3',
    )
    expect(diceTrayLabel({ activePlayerName: '상대', currentRollNumber: 1, isMyTurn: false })).toBe(
      '롤링 존 · 상대의 턴',
    )
  })
})

describe('diceTrayStatus', () => {
  const base = {
    activePlayerName: '상대',
    allKept: false,
    isMyTurn: true,
    rolled: false,
    roundNumber: 3,
    submitted: false,
  }

  it('제출·남의 턴·모두 킵·굴린 뒤·시작 전 순서로 갈린다', () => {
    expect(diceTrayStatus({ ...base, submitted: true })).toContain('점수가 반영')
    expect(diceTrayStatus({ ...base, isMyTurn: false })).toBe('상대님이 굴리는 중입니다')
    expect(diceTrayStatus({ ...base, allKept: true })).toContain('모두 킵했습니다')
    expect(diceTrayStatus({ ...base, rolled: true })).toContain('홀드하고 다시 굴리거나')
    expect(diceTrayStatus(base)).toBe('라운드 3 — 굴려서 시작하세요')
  })

  it('턴 주인의 이름을 모르면 자리만 비워 둔다', () => {
    expect(diceTrayStatus({ ...base, activePlayerName: undefined, isMyTurn: false })).toBe(
      '—님이 굴리는 중입니다',
    )
  })
})

describe('keepRail', () => {
  it('주사위가 없으면 합은 0이고 킵 수만 그대로 전한다', () => {
    expect(
      keepRailState({ dice: null, held: NO_HELD_DICE } as GamePlayRoll['local'], 2, false),
    ).toEqual({
      count: 2,
      sum: 0,
      full: false,
    })
  })

  it('마지막 굴림이 진행 중이면 다섯 알이 전부 레일 위에 있다', () => {
    expect(keepRailState(local(), 0, true)).toEqual({ count: 5, sum: 20, full: true })
  })

  it('킵한 알만 합에 든다', () => {
    const held = [true, false, true, false, false] as const
    expect(keepRailState(local({ held }), 2, false)).toEqual({ count: 2, sum: 10, full: false })
  })

  it('레일이 비면 그렇게 말하고, 가득 찼는데 굴림이 남았으면 해제를 권한다', () => {
    expect(keptRailLabel({ count: 0, sum: 0, full: false }, 2)).toBe('비어 있음')
    expect(keptRailLabel({ count: 5, sum: 20, full: true }, 2)).toBe(
      '5/5 · 합 20 · 해제해야 굴릴 수 있어요',
    )
    // 굴림이 남지 않았으면 해제를 권할 이유가 없다.
    expect(keptRailLabel({ count: 5, sum: 20, full: true }, 0)).toBe('5/5 · 합 20')
  })
})
