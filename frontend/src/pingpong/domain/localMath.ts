/**
 * 로컬 탁구가 쓰는 **작은 수치 도구** — 보간·클램프·난수 범위.
 *
 * 게임 루프(`localGame.ts`)와 스윙(`localSwing.ts`)이 함께 쓰는데 어느 쪽에도
 * 속하지 않는다. 한 곳에 두면 두 모듈이 서로를 임포트하지 않는다.
 */

export type RandomSource = () => number

export const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount

export const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))

export const randomBetween = (low: number, high: number, random: RandomSource): number =>
  low + random() * (high - low)
