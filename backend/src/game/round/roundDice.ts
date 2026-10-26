/**
 * 굴림 결과 합치기 — 유지(KEEP)한 자리는 이전 주사위 값을 남긴다.
 * `RoundState`에서 빼 두어 전이 객체가 검증과 값 보관에 집중하게 한다.
 */
export function mergeRolledDice(
  previousDice: readonly number[] | null,
  rolledDice: readonly number[],
  held: readonly boolean[],
): number[] {
  const nextDice = [...rolledDice]
  if (previousDice === null) return nextDice
  for (let index = 0; index < held.length; index += 1) {
    const kept = previousDice[index]
    if (held[index] === true && kept !== undefined) nextDice[index] = kept
  }
  return nextDice
}
