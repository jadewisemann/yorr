/**
 * 선언 규칙. 순수 함수만 있고 React·네트워크를 모른다.
 *
 * 판정의 진실은 서버(`LiarsRules`)다 — 여기 있는 검사는 **되돌릴 조작을 미리 막기 위한 거울**이다.
 * 못 보낼 선언을 버튼으로 열어두면 사용자는 눌러 보고 거절당한 뒤에야 규칙을 알게 된다.
 * 그래서 규칙을 두 번 적는 대신, 서버가 던지는 사유와 1:1로 대응하는 최소한만 둔다.
 */
import type { LiarsBid, LiarsState } from '@/realtime/wsEvents'

export const LIARS_FACES = 6

/** 판에 남아 있는 주사위 총합 — 선언 수량의 상한이다. */
export function totalDiceInPlay(dice: Record<string, number>): number {
  return Object.values(dice).reduce((sum, count) => sum + count, 0)
}

export function countFace(dice: readonly number[], face: number): number {
  return dice.filter((value) => value === face).length
}

/** 직전 선언보다 높은가. 수량이 오르거나, 같은 수량에서 눈이 커야 한다. */
export function raisesBid(standing: LiarsBid, quantity: number, face: number): boolean {
  return quantity > standing.quantity || (quantity === standing.quantity && face > standing.face)
}

/**
 * 이 선언을 보낼 수 없는 이유. 보낼 수 있으면 null.
 * 문구가 그대로 화면에 뜨므로 사유마다 무엇을 고쳐야 하는지 말해준다.
 */
export function bidError(
  standing: LiarsBid | null | undefined,
  quantity: number,
  face: number,
  totalDice: number,
): string | null {
  if (!Number.isInteger(face) || face < 1 || face > LIARS_FACES) return '주사위 눈은 1~6이에요'
  if (!Number.isInteger(quantity) || quantity < 1) return '수량은 1개 이상이어야 해요'
  if (quantity > totalDice) return `판에 남은 주사위는 ${totalDice}개예요`
  if (standing && !raisesBid(standing, quantity, face)) return '직전 선언보다 높게 불러야 해요'
  return null
}

/**
 * 지금 부를 수 있는 가장 낮은 선언. 선언 조작판의 시작값이다.
 * 더 높일 수 없으면 null — 그때 남은 선택은 의심(챌린지)뿐이다.
 */
export function lowestLegalBid(
  standing: LiarsBid | null | undefined,
  totalDice: number,
): { quantity: number; face: number } | null {
  if (totalDice < 1) return null
  if (!standing) return { quantity: 1, face: 1 }
  const raised =
    standing.face < LIARS_FACES
      ? { quantity: standing.quantity, face: standing.face + 1 }
      : { quantity: standing.quantity + 1, face: 1 }
  return raised.quantity > totalDice ? null : raised
}

/** 아직 주사위를 들고 있는 사람들. 자리 순서를 그대로 유지한다. */
export function alivePlayers(view: Pick<LiarsState, 'dice' | 'playerOrder'>): string[] {
  return view.playerOrder.filter((playerId) => (view.dice[playerId] ?? 0) > 0)
}
