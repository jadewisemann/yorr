import { z } from 'zod'
import type { DiceHoldPayload, DiceRollPayload, RoundSubmitPayload } from '../round/index.js'

/**
 * 인바운드 payload 파싱.
 *
 * **관용 규칙이 계약이다**: 타입이 어긋나면 파싱 실패(→ `INVALID_MESSAGE`
 * "invalid dice.roll payload"), **없는 필드는 자바 기본값**(int 0, 참조 null)이 된다.
 * 그래서 스키마는 전부 `nullish()`이고, 빈 자리는 아래 `to*` 변환이 도메인 검증에
 * 걸리는 값(0 / 빈 배열 / 빈 문자열)으로 메운다.
 *
 * 이 laxness가 중요한 이유: 검증을 여기서 엄격하게 하면 **오류 코드가 바뀐다.**
 * held가 빠진 `dice.roll`은 `RoundState.recordRoll`의 `INVALID_ROLL`을 거쳐
 * `INVALID_MESSAGE`가 되지만, 그 전에 payload 파싱이 거부하면 같은 `INVALID_MESSAGE`라도
 * **턴 소유 검증(NOT_YOUR_TURN)보다 앞서게** 되어 남의 턴에 보낸 깨진 굴림의 응답이
 * 달라진다. 도메인이 먼저 보는 순서가 계약이다.
 */

/** 배열 원소는 검사하지 않는다 — 값 유효성은 라운드 도메인이 이유 코드와 함께 판정한다. */
const looseArray = z.array(z.unknown()).nullish()

export const diceRollPayloadSchema = z.object({
  roundNumber: z.number().nullish(),
  rollCount: z.number().nullish(),
  held: looseArray,
})

export const diceHoldPayloadSchema = z.object({
  roundNumber: z.number().nullish(),
  held: looseArray,
})

export const diceShakePayloadSchema = z.object({
  roundNumber: z.number().nullish(),
  direction: z.string().nullish(),
  strength: z.number().nullish(),
})

export const diceThrowPayloadSchema = z.object({
  roundNumber: z.number().nullish(),
  rollCount: z.number().nullish(),
})

export const roundSubmitPayloadSchema = z.object({
  roundNumber: z.number().nullish(),
  dice: looseArray,
  category: z.string().nullish(),
})

export type DiceShakeRequest = {
  readonly roundNumber: number
  readonly direction: string | null
  readonly strength: number
}

export type DiceThrowRequest = {
  readonly roundNumber: number
  readonly rollCount: number
}

/**
 * `unknown[]` → 도메인이 기대하는 배열. **여기서 값을 고치지 않는다** —
 * boolean이 아닌 원소는 그대로 넘겨 `validateHeld`가 `INVALID_ROLL`을 던지게 한다.
 */
const asBooleans = (values: readonly unknown[] | null | undefined): readonly boolean[] =>
  (values ?? []) as readonly boolean[]

const asNumbers = (values: readonly unknown[] | null | undefined): readonly number[] =>
  (values ?? []) as readonly number[]

export const toDiceRollPayload = (
  parsed: z.infer<typeof diceRollPayloadSchema>,
): DiceRollPayload => ({
  roundNumber: parsed.roundNumber ?? 0,
  rollCount: parsed.rollCount ?? 0,
  held: asBooleans(parsed.held),
})

export const toDiceHoldPayload = (
  parsed: z.infer<typeof diceHoldPayloadSchema>,
): DiceHoldPayload => ({
  roundNumber: parsed.roundNumber ?? 0,
  held: asBooleans(parsed.held),
})

/** `direction`은 null로 남긴다 — 봉투에 그대로 실린다. */
export const toDiceShakeRequest = (
  parsed: z.infer<typeof diceShakePayloadSchema>,
): DiceShakeRequest => ({
  roundNumber: parsed.roundNumber ?? 0,
  direction: parsed.direction ?? null,
  strength: parsed.strength ?? 0,
})

export const toDiceThrowRequest = (
  parsed: z.infer<typeof diceThrowPayloadSchema>,
): DiceThrowRequest => ({
  roundNumber: parsed.roundNumber ?? 0,
  rollCount: parsed.rollCount ?? 0,
})

export const toRoundSubmitPayload = (
  parsed: z.infer<typeof roundSubmitPayloadSchema>,
): RoundSubmitPayload => ({
  roundNumber: parsed.roundNumber ?? 0,
  dice: asNumbers(parsed.dice),
  // 빈 문자열은 `SUPPORTED_CATEGORIES`에 없으므로 `INVALID_CATEGORY`가 된다.
  category: parsed.category ?? '',
})
