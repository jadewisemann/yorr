import { describe, expect, it } from 'vitest'
import {
  DAVINCI_DECK_SIZE,
  decide,
  forfeit,
  guess,
  initialDavinciState,
  place,
} from '../davinciRules.js'
import type { DavinciState, DavinciTile } from '../davinciState.js'
import { deckOrder, GUEST, HOST, NOW, THIRD, tilesOf, twoPlayerState } from './davinciFixtures.js'

/**
 * 아래는 **잘못 불린 전이가 상태를 건드리지 않는다**는 계약이다. 서비스가 늦게 도착한
 * 입력이나 지나간 국면의 마감을 그대로 흘려보내므로, 규칙이 스스로 막아야 한다.
 */
describe('물리치는 갈래', () => {
  const state = twoPlayerState()
  const otherTile = (source: DavinciState, playerId: string): DavinciTile => {
    const tile = tilesOf(source, playerId)[0]
    if (tile === undefined) throw new Error('타일이 없다')
    return tile
  }

  it('같은 사람이 두 번 앉거나 순열이 깨지면 판을 열지 않는다', () => {
    expect(() => initialDavinciState([HOST, HOST], deckOrder(), NOW)).toThrow(
      'davinci_duplicate_player',
    )
    // 인덱스가 타일 목록 밖이면 순열이 아니다.
    const outOfRange = deckOrder().map((index) => (index === 0 ? DAVINCI_DECK_SIZE : index))
    expect(() => initialDavinciState([HOST, GUEST], outOfRange, NOW)).toThrow(
      'davinci_invalid_deck_order',
    )
  })

  it('이미 부른 입력 번호와 남의 차례에 온 입력은 무시한다', () => {
    const tile = otherTile(state, GUEST)
    const guessed = guess(state, HOST, 0, GUEST, tile.id, tile.number, NOW)

    // 결정 단계: 같은 번호 재전송과 남의 결정은 둘 다 그대로 돌려준다.
    expect(decide(guessed, HOST, 0, 'STOP', NOW)).toBe(guessed)
    expect(decide(guessed, GUEST, 5, 'STOP', NOW)).toBe(guessed)

    // 추측 단계: 같은 번호 재전송은 무시한다.
    expect(guess(guessed, HOST, 0, GUEST, tile.id, tile.number, NOW)).toBe(guessed)
  })

  it('탈락한 사람이나 부를 수 없는 숫자는 추측 대상이 되지 않는다', () => {
    const tile = otherTile(state, GUEST)
    expect(guess(state, HOST, 0, GUEST, tile.id, 99, NOW)).toBe(state)

    const eliminated: DavinciState = { ...state, eliminated: [GUEST] }
    expect(guess(eliminated, HOST, 0, GUEST, tile.id, tile.number, NOW)).toBe(eliminated)
  })

  it('놓기 단계가 아니거나 같은 입력 번호인 놓기는 무시한다', () => {
    expect(place(state, HOST, 0, 0, NOW)).toBe(state)
  })

  it('이미 끝난 판과 방에 없는 사람의 이탈은 아무것도 하지 않는다', () => {
    const finished: DavinciState = { ...state, phase: 'FINISHED' }
    expect(forfeit(finished, HOST, NOW)).toBe(finished)
    expect(forfeit(state, '구경꾼', NOW)).toBe(state)
  })

  it('내 차례가 아닌 사람이 나가면 판은 그 자리에 머문다', () => {
    const three = initialDavinciState([HOST, GUEST, THIRD], deckOrder(), NOW)

    const left = forfeit(three, GUEST, NOW)

    // 차례는 그대로 HOST다 — 넘길 이유가 없다.
    expect(left.turnPlayerId).toBe(HOST)
    expect(left.eliminated).toContain(GUEST)
    expect(left.phase).toBe('GUESSING')
  })
})
