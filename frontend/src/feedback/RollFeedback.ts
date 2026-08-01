import type { PhysicsDiceIndex, PhysicsDicePhase } from '@/rendering/physics-dice/types'

export interface RollFeedback {
  armed(): void
  diceImpact(index: PhysicsDiceIndex, strength: number): void
  dispose(): void
  error(): void
  phaseChanged(phase: PhysicsDicePhase): void
  /**
   * 남이 흔든 펄스(dice.shaken)를 받았다. 사발 소리만 이어 주고 진동은 내지 않는다 —
   * 내 손이 움직인 게 아니라서, 관전 중에 폰이 울리면 내 차례로 착각한다.
   */
  remoteShakePulse(): void
  setMuted(muted: boolean): void
  shakePulse(direction: 'left' | 'right', strength: number): void
  thrown(): void
}
