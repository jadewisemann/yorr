export type RollInputMode = 'motion' | 'tap'

export interface RollIntent {
  inputMode: RollInputMode
  createdAt: number
}
