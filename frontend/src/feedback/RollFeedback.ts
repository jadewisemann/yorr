import type { PhysicsDiceIndex, PhysicsDicePhase } from '@/rendering/physics-dice/types'

export interface RollFeedback {
  armed(): void
  diceImpact(index: PhysicsDiceIndex, strength: number): void
  dispose(): void
  error(): void
  phaseChanged(phase: PhysicsDicePhase): void
  setMuted(muted: boolean): void
  shakePulse(direction: 'left' | 'right', strength: number): void
  thrown(): void
}
