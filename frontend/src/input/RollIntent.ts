export type RollInputMode = 'motion' | 'tap'

export type RollIntent =
  | {
      type: 'roll'
      inputMode: 'motion'
      createdAt: number
      confidence: number
    }
  | {
      type: 'roll'
      inputMode: 'tap'
      createdAt: number
    }
