const FACE_COUNT = 6

/**
 * 정책이 말한 **킵 의도**를 주사위 자리로 옮긴다 — 이미 잡힌 자리에 우선권을 준다.
 *
 * 정책은 "6을 두 개 남긴다"까지만 말하고 어느 자리인지는 신경 쓰지 않는다. 그런데
 * 자리를 바꿔서 보내면 값은 같은데 `dice.hold_changed`가 한 번 더 나가고,
 * 프론트에서는 주사위가 이유 없이 풀렸다 다시 잡힌다. 그래서 **이미 잡혀 있는
 * 자리에 우선권**을 준다.
 */
export const preserveHeldDiceIdentity = (
  dice: readonly number[],
  currentHeld: readonly boolean[] | null,
  desiredHeld: readonly boolean[],
): readonly boolean[] => {
  if (
    currentHeld === null ||
    currentHeld.length !== dice.length ||
    desiredHeld.length !== dice.length
  ) {
    return desiredHeld
  }

  const remainingByFace = new Array<number>(FACE_COUNT).fill(0)
  for (let index = 0; index < dice.length; index += 1) {
    if (desiredHeld[index] === true) {
      const face = faceIndexOf(dice, index)
      remainingByFace[face] = (remainingByFace[face] ?? 0) + 1
    }
  }

  const resolved = new Array<boolean>(dice.length).fill(false)
  // 1차: 지금 잡혀 있는 자리부터 채운다(같은 면이면 그 자리를 유지).
  claimQuota(dice, resolved, remainingByFace, (index) => currentHeld[index] === true)
  // 2차: 남은 몫을 앞자리부터 채운다.
  claimQuota(dice, resolved, remainingByFace, () => true)
  return Object.freeze(resolved)
}

const faceIndexOf = (dice: readonly number[], index: number): number => (dice[index] ?? 1) - 1

/**
 * `eligible`인 자리부터 면별 남은 몫을 소비해 `resolved`를 켠다. 두 번 호출되며
 * (① 이미 킵된 자리 ② 남은 자리) 그 순서가 "자리 유지" 규칙의 전부다.
 */
const claimQuota = (
  dice: readonly number[],
  resolved: boolean[],
  remainingByFace: number[],
  eligible: (index: number) => boolean,
): void => {
  for (let index = 0; index < dice.length; index += 1) {
    const face = faceIndexOf(dice, index)
    if (resolved[index] || !eligible(index)) continue
    if ((remainingByFace[face] ?? 0) <= 0) continue
    resolved[index] = true
    remainingByFace[face] = (remainingByFace[face] ?? 0) - 1
  }
}
