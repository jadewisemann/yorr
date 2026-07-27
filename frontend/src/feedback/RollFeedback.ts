export interface RollFeedback {
  armed(): void
  dispose(): void
  error(): void
  shakePulse(direction: 'left' | 'right', strength: number): void
  thrown(): void
}
