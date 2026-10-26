import type { Fault } from './court'

/**
 * 로컬 탁구의 **도메인 타입** — 상태·피드백·난이도.
 *
 * 왜 별도 파일인가: 상태를 만드는 쪽(`localGame`)과 그 상태를 소비하는 쪽
 * (`localBall`·`localSwing`·`localBot`)이 서로를 참조하면 순환 의존이 된다.
 * 타입만 여기 모으면 의존이 한 방향(소비자 → 타입)으로 유지된다.
 */

export type LocalPingPongMode = 'solo' | 'duo'
export type LocalPingPongDifficulty = 'easy' | 'normal' | 'hard'
export type LocalPingPongPhase = 'playing' | 'point' | 'over'
export type LocalFeedbackKind = 'smash' | 'nice' | 'ok' | 'miss' | 'good' | 'bad'

export interface LocalBall {
  dir: 1 | -1
  fall: number
  fault: Fault
  faultFrom: number
  hit: boolean
  pos: number
  smash: boolean
  speed: number
  x: number
  x0: number
  x1: number
}

export interface LocalPingPongState {
  ball: LocalBall
  countdown: number
  difficulty: LocalPingPongDifficulty
  flashAt: number
  mode: LocalPingPongMode
  nextServeAt: number
  p1SwingAt: number
  p1X: number
  p2SwingAt: number
  p2X: number
  phase: LocalPingPongPhase
  rally: number
  s1: number
  s2: number
  serveReceiver: 1 | 2
  shakeAt: number
}

export interface LocalFeedback {
  kind: LocalFeedbackKind
  text: string
}
