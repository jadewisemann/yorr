export type Pose = 'ready' | 'draw' | 'hit' | 'dead'

export interface Outfit {
  scarf: string
  rim: string
}

export const OUTFIT_LEFT: Outfit = { scarf: '#e0483a', rim: '#ffb56b' }
export const OUTFIT_RIGHT: Outfit = { scarf: '#38bdf8', rim: '#ffd08a' }

export type ArenaPhase = 'waiting' | 'signal' | 'result'

export interface Fighter {
  name: string
  pose: Pose
  outfit: Outfit
  hp: number
  ms: number | null
  fouls: number
}
