export type PhysicsDiceValue = 1 | 2 | 3 | 4 | 5 | 6

export type PhysicsDiceSet = readonly [
  PhysicsDiceValue,
  PhysicsDiceValue,
  PhysicsDiceValue,
  PhysicsDiceValue,
  PhysicsDiceValue,
]

export type PhysicsHeldDice = readonly [boolean, boolean, boolean, boolean, boolean]
export type PhysicsDiceIndex = 0 | 1 | 2 | 3 | 4
export type PhysicsDiceQuality = 'eco' | 'balanced' | 'high'
export type PhysicsDicePhase = 'idle' | 'shaking' | 'pouring' | 'aligning'

export interface PhysicsDiceRollRequest {
  requestId: string
  seed: number
  held: PhysicsHeldDice
  targetDice: PhysicsDiceSet
}

export interface PhysicsDiceWorldCallbacks {
  onError(error: Error): void
  onHeldToggle(index: PhysicsDiceIndex): void
  onPhaseChange(phase: PhysicsDicePhase): void
  onResizeChange(resizing: boolean): void
  onRollComplete(requestId: string, dice: PhysicsDiceSet): void
}

export interface PhysicsDiceWorldOptions {
  callbacks: PhysicsDiceWorldCallbacks
  container: HTMLElement
  quality: PhysicsDiceQuality
}
