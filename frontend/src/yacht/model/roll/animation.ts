import type { DiceSet } from '@/yacht/domain/dice'

/** 내가 굴린 방식 — 화면을 흔들어 굴렸는지, 눌러서 굴렸는지. */
export type RollInputMode = 'motion' | 'tap'
/** 화면이 실제로 그리는 방식. 남의 굴림(`remote`)과 서버 자동 굴림(`auto`)이 더 있다. */
export type RollAnimationMode = RollInputMode | 'remote' | 'auto'

/** 같은 서버 굴림을 받은 모든 클라이언트가 같은 물리 난수열을 쓰게 하는 32비트 FNV-1a. */
export function animationSeedForRoll(
  roomId: string,
  playerId: string,
  roundNumber: number,
  rollCount: number,
  dice: DiceSet,
) {
  const key = `${roomId}:${playerId}:${roundNumber}:${rollCount}:${dice.join('')}`
  let hash = 2_166_136_261
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16_777_619)
  }
  return hash >>> 0
}

/**
 * 이 굴림을 어떻게 그릴지. 서버가 대신 굴렸으면 자동, 내가 요청한 것이면 그때 쓴 입력,
 * 그 외에는 남의 굴림이다.
 */
export function rollAnimationMode({
  forced,
  ownRoll,
  pendingInputMode,
}: {
  forced: boolean
  ownRoll: boolean
  pendingInputMode: RollInputMode | null
}): RollAnimationMode {
  if (forced) return 'auto'
  if (pendingInputMode) return pendingInputMode
  return ownRoll ? 'tap' : 'remote'
}
