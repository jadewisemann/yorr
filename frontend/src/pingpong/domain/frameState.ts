import type { Fault } from './court'

export type Viewer = 1 | 2

export interface FrameState {
  split: boolean
  viewer: Viewer
  playing: boolean
  ballPos: number
  ballDir: 1 | -1
  ballX: number
  ballSmash: boolean
  ballHit: boolean
  ballFault: Fault
  ballFaultFrom: number
  ballFall: number
  p1X: number
  p2X: number
  p1Swing: number
  p2Swing: number
  shake: number
}
