import { describe, expect, it } from 'vitest'
import {
  alivePlayers,
  bidError,
  countFace,
  lowestLegalBid,
  raisesBid,
  totalDiceInPlay,
} from '../liarsBid'

const standing = { playerId: 'p1', quantity: 3, face: 4 }

describe('raisesBid', () => {
  it('수량이 오르거나 같은 수량에서 눈이 커야 높은 선언이다', () => {
    expect(raisesBid(standing, 4, 1)).toBe(true)
    expect(raisesBid(standing, 3, 5)).toBe(true)
    expect(raisesBid(standing, 3, 4)).toBe(false)
    expect(raisesBid(standing, 3, 3)).toBe(false)
    expect(raisesBid(standing, 2, 6)).toBe(false)
  })
})

describe('bidError', () => {
  it('보낼 수 있는 선언은 사유가 없다', () => {
    expect(bidError(standing, 3, 5, 10)).toBeNull()
    expect(bidError(null, 1, 1, 10)).toBeNull()
  })

  it('판에 없는 수량은 부를 수 없다', () => {
    expect(bidError(null, 11, 3, 10)).toBe('판에 남은 주사위는 10개예요')
  })

  it('낮은 선언·범위를 벗어난 값은 각각 다른 안내를 준다', () => {
    expect(bidError(standing, 3, 4, 10)).toBe('직전 선언보다 높게 불러야 해요')
    expect(bidError(null, 1, 7, 10)).toBe('주사위 눈은 1~6이에요')
    expect(bidError(null, 0, 3, 10)).toBe('수량은 1개 이상이어야 해요')
  })
})

describe('lowestLegalBid', () => {
  it('선언이 없으면 가장 낮은 선언부터 시작한다', () => {
    expect(lowestLegalBid(null, 10)).toEqual({ quantity: 1, face: 1 })
  })

  it('눈을 올릴 수 있으면 눈만 한 칸 올린다', () => {
    expect(lowestLegalBid(standing, 10)).toEqual({ quantity: 3, face: 5 })
  })

  it('눈이 6이면 수량을 올리고 눈을 1로 되돌린다', () => {
    expect(lowestLegalBid({ playerId: 'p1', quantity: 3, face: 6 }, 10)).toEqual({
      quantity: 4,
      face: 1,
    })
  })

  // 더 높일 수 없는 선언이 서 있으면 남은 선택은 의심뿐이다 — 화면이 선언 버튼을 닫아야 한다.
  it('판에 남은 주사위를 넘게 되면 올릴 수 없다', () => {
    expect(lowestLegalBid({ playerId: 'p1', quantity: 4, face: 6 }, 4)).toBeNull()
    expect(lowestLegalBid(null, 0)).toBeNull()
  })
})

describe('countFace · totalDiceInPlay · alivePlayers', () => {
  it('같은 눈의 개수를 센다', () => {
    expect(countFace([1, 3, 3, 5, 6], 3)).toBe(2)
    expect(countFace([], 3)).toBe(0)
  })

  it('판에 남은 주사위를 합친다', () => {
    expect(totalDiceInPlay({ p1: 3, p2: 0, p3: 5 })).toBe(8)
  })

  it('탈락자는 빼고 자리 순서를 유지한다', () => {
    expect(
      alivePlayers({ dice: { p1: 0, p2: 2, p3: 1 }, playerOrder: ['p1', 'p2', 'p3'] }),
    ).toEqual(['p2', 'p3'])
  })
})
