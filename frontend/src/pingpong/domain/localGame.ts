import { MISS1, MISS2, NORMAL_SPEED, WIN_SCORE } from './court'
import type { FrameState } from './frameState'
import { baseSpeed, botReturn, updateBallPosition, updateFault } from './localBall'
import { type RandomSource, randomBetween } from './localMath'
import { SWING_MS } from './localSwing'
import type {
  LocalBall,
  LocalFeedback,
  LocalPingPongDifficulty,
  LocalPingPongMode,
  LocalPingPongState,
} from './localTypes'

export { type LocalSwing, swingLocalGame } from './localSwing'
export type {
  LocalBall,
  LocalFeedback,
  LocalFeedbackKind,
  LocalPingPongDifficulty,
  LocalPingPongMode,
  LocalPingPongPhase,
  LocalPingPongState,
} from './localTypes'

const POINT_COUNTDOWN_MS = 2_600
const SHAKE_MS = 190

function newBall(): LocalBall {
  return {
    dir: 1,
    fall: 0,
    fault: null,
    faultFrom: 0,
    hit: false,
    pos: 0.02,
    smash: false,
    speed: NORMAL_SPEED,
    x: 0.5,
    x0: 0.5,
    x1: 0.5,
  }
}

export function createLocalGame(
  mode: LocalPingPongMode,
  difficulty: LocalPingPongDifficulty,
  random: RandomSource = Math.random,
): LocalPingPongState {
  const state: LocalPingPongState = {
    ball: newBall(),
    countdown: 0,
    difficulty,
    flashAt: -1e9,
    mode,
    nextServeAt: 0,
    p1SwingAt: -1e9,
    p1X: 0.5,
    p2SwingAt: -1e9,
    p2X: 0.5,
    phase: 'playing',
    rally: 0,
    s1: 0,
    s2: 0,
    serveReceiver: 1,
    shakeAt: -1e9,
  }
  serveTo(state, 1, random)
  return state
}

export function restartLocalGame(state: LocalPingPongState, random: RandomSource = Math.random) {
  Object.assign(state, createLocalGame(state.mode, state.difficulty, random))
}

function serveTo(state: LocalPingPongState, receiver: 1 | 2, random: RandomSource) {
  const ball = newBall()
  ball.speed = baseSpeed(state)
  if (receiver === 2) {
    ball.pos = 0.98
    ball.dir = -1
  }
  ball.x1 = randomBetween(0.3, 0.7, random)
  state.ball = ball
  state.countdown = 0
  state.phase = 'playing'
  state.rally = 0
}

function pointFeedback(state: LocalPingPongState, scorer: 1 | 2): LocalFeedback {
  if (state.mode === 'solo') {
    return scorer === 1 ? { kind: 'good', text: '득점!' } : { kind: 'bad', text: '실점' }
  }
  return { kind: 'good', text: `P${scorer} 득점!` }
}

function scorePoint(state: LocalPingPongState, scorer: 1 | 2, now: number): LocalFeedback {
  if (scorer === 1) state.s1 += 1
  else state.s2 += 1

  if ((state.s1 >= WIN_SCORE || state.s2 >= WIN_SCORE) && Math.abs(state.s1 - state.s2) >= 2) {
    state.phase = 'over'
    return pointFeedback(state, scorer)
  }

  state.phase = 'point'
  state.nextServeAt = now + POINT_COUNTDOWN_MS
  state.serveReceiver = state.mode === 'solo' ? 1 : scorer === 1 ? 2 : 1
  return pointFeedback(state, scorer)
}

function updatePointCountdown(
  state: LocalPingPongState,
  now: number,
  dt: number,
  random: RandomSource,
) {
  if (state.ball.fault) state.ball.fall = Math.min(1.2, state.ball.fall + dt)
  const remaining = state.nextServeAt - now
  state.countdown = remaining <= 1_800 ? Math.max(0, Math.min(3, Math.ceil(remaining / 600))) : 0
  if (now >= state.nextServeAt) serveTo(state, state.serveReceiver, random)
}

export function advanceLocalGame(
  state: LocalPingPongState,
  now: number,
  dt: number,
  random: RandomSource = Math.random,
): LocalFeedback | null {
  if (state.phase === 'point') {
    updatePointCountdown(state, now, dt, random)
    return null
  }
  if (state.phase !== 'playing') return null

  const ball = state.ball
  ball.pos += ball.speed * dt * ball.dir
  if (ball.fault) return updateFault(state, now, scorePoint)

  updateBallPosition(state)
  if (ball.dir > 0 && ball.pos >= MISS1) return scorePoint(state, 2, now)
  if (ball.dir >= 0) return null
  if (state.mode === 'solo' && ball.pos <= 0) return botReturn(state, now, random, scorePoint)
  if (state.mode === 'duo' && ball.pos <= MISS2) return scorePoint(state, 1, now)
  return null
}

function swingAmount(now: number, at: number) {
  return now - at < SWING_MS ? 1 - (now - at) / SWING_MS : 0
}

export function localFrameState(state: LocalPingPongState, now: number): FrameState {
  return {
    ballDir: state.ball.dir,
    ballFall: state.ball.fall,
    ballFault: state.ball.fault,
    ballFaultFrom: state.ball.faultFrom,
    ballHit: state.ball.hit,
    ballPos: state.ball.pos,
    ballSmash: state.ball.smash,
    ballX: state.ball.x,
    p1Swing: swingAmount(now, state.p1SwingAt),
    p1X: state.p1X,
    p2Swing: swingAmount(now, state.p2SwingAt),
    p2X: state.p2X,
    playing: state.phase === 'playing',
    shake: now - state.shakeAt < SHAKE_MS ? 1 - (now - state.shakeAt) / SHAKE_MS : 0,
    split: state.mode === 'duo',
    viewer: 1,
  }
}
