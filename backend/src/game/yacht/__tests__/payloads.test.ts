import { describe, expect, it } from 'vitest'
import {
  diceHoldPayloadSchema,
  diceRollPayloadSchema,
  diceShakePayloadSchema,
  diceThrowPayloadSchema,
  roundSubmitPayloadSchema,
  toDiceHoldPayload,
  toDiceRollPayload,
  toDiceShakeRequest,
  toDiceThrowRequest,
  toRoundSubmitPayload,
} from '../payloads.js'

/**
 * 인바운드 payload의 **관용 규칙**이 계약이다(TESTING.md 「경계값」·표 기반).
 *
 * 두 가지를 표로 고정한다.
 *
 * 1. **없는 필드는 자바 기본값**이 된다 — int 0, 참조 null, 배열 빈 배열.
 *    이 규칙이 깨지면 오류 코드가 달라진다(파싱 실패가 도메인 검증보다 앞서게 된다).
 * 2. **타입이 어긋나면 파싱 실패**다 — 숫자 자리에 문자열이 오면 통과시키지 않는다.
 *
 * 빈 객체(`{}`)가 가장 중요한 행이다. 봉투만 있고 payload가 빈 메시지가 실제로 오고,
 * 그때 0/빈배열/빈문자열이 도메인 검증까지 흘러가야 한다.
 */

describe('dice.roll', () => {
  it.each([
    ['빈 payload', {}, { roundNumber: 0, rollCount: 0, held: [] }],
    [
      'null 필드',
      { roundNumber: null, rollCount: null, held: null },
      { roundNumber: 0, rollCount: 0, held: [] },
    ],
    [
      '정상 값',
      { roundNumber: 2, rollCount: 1, held: [true, false] },
      { roundNumber: 2, rollCount: 1, held: [true, false] },
    ],
    // 값 검증은 하지 않는다 — 원소가 boolean이 아니어도 그대로 넘겨 도메인이 INVALID_ROLL을 던진다.
    [
      '이상한 원소도 통과',
      { held: ['yes', 3] },
      { roundNumber: 0, rollCount: 0, held: ['yes', 3] },
    ],
    // 0은 falsy지만 ??는 null/undefined만 본다 — 0이 기본값으로 덮이면 안 된다.
    [
      '0을 기본값으로 덮지 않는다',
      { roundNumber: 0, rollCount: 0 },
      { roundNumber: 0, rollCount: 0, held: [] },
    ],
  ])('%s', (_label, input, expected) => {
    const parsed = diceRollPayloadSchema.parse(input)
    expect(toDiceRollPayload(parsed)).toEqual(expected)
  })

  it('타입이 어긋나면 파싱 실패다', () => {
    expect(() => diceRollPayloadSchema.parse({ roundNumber: '2' })).toThrow()
    expect(() => diceRollPayloadSchema.parse({ held: 'not-an-array' })).toThrow()
    expect(() => diceRollPayloadSchema.parse({ held: { 0: true } })).toThrow()
  })
})

describe('dice.hold', () => {
  it.each([
    ['빈 payload', {}, { roundNumber: 0, held: [] }],
    ['null 필드', { roundNumber: null, held: null }, { roundNumber: 0, held: [] }],
    [
      '정상 값',
      { roundNumber: 3, held: [true, true, false, false, false] },
      { roundNumber: 3, held: [true, true, false, false, false] },
    ],
  ])('%s', (_label, input, expected) => {
    expect(toDiceHoldPayload(diceHoldPayloadSchema.parse(input))).toEqual(expected)
  })
})

describe('dice.shake', () => {
  it.each([
    // direction만 참조(null)로 남는다 — 봉투에 그대로 실려야 화면이 방향을 안다.
    ['빈 payload', {}, { roundNumber: 0, direction: null, strength: 0 }],
    [
      'null 필드',
      { roundNumber: null, direction: null, strength: null },
      { roundNumber: 0, direction: null, strength: 0 },
    ],
    [
      '정상 값',
      { roundNumber: 1, direction: 'left', strength: 0.7 },
      { roundNumber: 1, direction: 'left', strength: 0.7 },
    ],
    // 세기 0은 "흔들었다"는 사실만 남긴다.
    ['세기 0', { strength: 0 }, { roundNumber: 0, direction: null, strength: 0 }],
  ])('%s', (_label, input, expected) => {
    expect(toDiceShakeRequest(diceShakePayloadSchema.parse(input))).toEqual(expected)
  })
})

describe('dice.throw', () => {
  it.each([
    ['빈 payload', {}, { roundNumber: 0, rollCount: 0 }],
    ['null 필드', { roundNumber: null, rollCount: null }, { roundNumber: 0, rollCount: 0 }],
    ['정상 값', { roundNumber: 5, rollCount: 2 }, { roundNumber: 5, rollCount: 2 }],
  ])('%s', (_label, input, expected) => {
    expect(toDiceThrowRequest(diceThrowPayloadSchema.parse(input))).toEqual(expected)
  })
})

describe('round.submit', () => {
  it.each([
    // 빈 category는 SUPPORTED_CATEGORIES에 없으므로 도메인이 INVALID_CATEGORY를 던진다.
    ['빈 payload', {}, { roundNumber: 0, dice: [], category: '' }],
    [
      'null 필드',
      { roundNumber: null, dice: null, category: null },
      { roundNumber: 0, dice: [], category: '' },
    ],
    [
      '정상 값',
      { roundNumber: 4, dice: [1, 2, 3, 4, 5], category: 'yacht' },
      { roundNumber: 4, dice: [1, 2, 3, 4, 5], category: 'yacht' },
    ],
    [
      '주사위 원소는 검사하지 않는다',
      { dice: ['x', null] },
      { roundNumber: 0, dice: ['x', null], category: '' },
    ],
  ])('%s', (_label, input, expected) => {
    expect(toRoundSubmitPayload(roundSubmitPayloadSchema.parse(input))).toEqual(expected)
  })

  it('타입이 어긋나면 파싱 실패다', () => {
    expect(() => roundSubmitPayloadSchema.parse({ category: 7 })).toThrow()
    expect(() => roundSubmitPayloadSchema.parse({ dice: 'x' })).toThrow()
  })
})

/**
 * **관용 규칙의 회귀선.** 이 표의 모든 행이 "파싱은 통과, 값은 도메인이 판정"이다.
 * 여기서 하나라도 던지면 그 메시지의 오류 코드가 바뀐다 — 남의 턴에 보낸 깨진
 * 굴림이 NOT_YOUR_TURN 대신 INVALID_MESSAGE가 되는 식이다.
 */
describe('관용 규칙 — 어떤 빈 payload도 파싱에서 죽지 않는다', () => {
  it.each([
    ['dice.roll', diceRollPayloadSchema],
    ['dice.hold', diceHoldPayloadSchema],
    ['dice.shake', diceShakePayloadSchema],
    ['dice.throw', diceThrowPayloadSchema],
    ['round.submit', roundSubmitPayloadSchema],
  ])('%s', (_label, schema) => {
    expect(() => schema.parse({})).not.toThrow()
    expect(() => schema.parse(undefined)).toThrow() // 객체 자체가 없으면 실패 — 이건 계약이다
  })
})
