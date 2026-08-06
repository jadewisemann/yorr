import {
  FAULT_BAND,
  type Fault,
  faultOf,
  flightProgress,
  GOOD_D,
  IDEAL1,
  IDEAL2,
  MISS1,
  MISS2,
  NET_HIT_PROG,
  NORMAL_SPEED,
  OUT_END_PROG,
  PERFECT_D,
  SMASH_SPEED,
  W1_HI,
  W1_LO,
  W2_HI,
  W2_LO,
  WEAK_SPEED,
  WIN_SCORE,
} from './court'
import type { FrameState } from './frameState'
import { trackIncomingBall } from './playerTracking'

const POINT_COUNTDOWN_MS = 2_600
const SWING_MS = 260
const SWING_LOCK_MS = 260
const SHAKE_MS = 190

export type LocalPingPongMode = 'solo' | 'duo'
export type LocalPingPongDifficulty = 'easy' | 'normal' | 'hard'
export type LocalPingPongPhase = 'playing' | 'point' | 'over'
export type LocalFeedbackKind = 'smash' | 'nice' | 'ok' | 'miss' | 'good' | 'bad'

interface BotSkill {
  band: number
  missNormal: number
  missSmash: number
  ramp: number
  rampCap: number
  smashBack: number
}

const BOT: Record<LocalPingPongDifficulty, BotSkill> = {
  easy: {
    band: 0.02,
    missNormal: 0.11,
    missSmash: 0.46,
    ramp: 0.005,
    rampCap: 0.08,
    smashBack: 0.05,
  },
  normal: {
    band: 0.04,
    missNormal: 0.07,
    missSmash: 0.2,
    ramp: 0.005,
    rampCap: 0.08,
    smashBack: 0.3,
  },
  hard: {
    band: 0.05,
    missNormal: 0.02,
    missSmash: 0.14,
    ramp: 0.005,
    rampCap: 0.08,
    smashBack: 0.3,
  },
}

interface LocalBall {
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

type RandomSource = () => number

const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const randomBetween = (low: number, high: number, random: RandomSource) =>
  low + random() * (high - low)

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

function baseSpeed(state: LocalPingPongState) {
  return NORMAL_SPEED + Math.min(0.35, (state.s1 + state.s2) * 0.02)
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

function botMisses(state: LocalPingPongState, skill: BotSkill, random: RandomSource) {
  const ball = state.ball
  const chance = ball.smash
    ? skill.missSmash
    : skill.missNormal + Math.min(skill.rampCap, state.rally * skill.ramp)
  return random() < chance
}

function setBotFault(state: LocalPingPongState, random: RandomSource) {
  const ball = state.ball
  ball.dir = 1
  ball.pos = 0
  ball.smash = false
  ball.hit = false
  ball.fault = random() < 0.5 ? 'out' : 'net'
  ball.faultFrom = 0
  ball.speed = ball.fault === 'out' ? NORMAL_SPEED : WEAK_SPEED
  ball.x0 = ball.x
  ball.x1 = randomBetween(0.15, 0.85, random)
}

function botReturn(state: LocalPingPongState, now: number, random: RandomSource) {
  const skill = BOT[state.difficulty]
  const ball = state.ball
  state.p2SwingAt = now

  if (botMisses(state, skill, random)) {
    if (random() < 0.5) return scorePoint(state, 1, now)
    setBotFault(state, random)
    return null
  }

  const smash = random() < skill.smashBack
  ball.dir = 1
  ball.pos = 0
  ball.smash = smash
  ball.hit = false
  ball.speed = smash ? SMASH_SPEED : baseSpeed(state) * randomBetween(0.95, 1.12, random)
  ball.x0 = ball.x
  ball.x1 = randomBetween(0.15, 0.85, random)
  if (smash) state.shakeAt = now
  state.rally += 1
  return null
}

function faultPoint(state: LocalPingPongState, now: number): LocalFeedback {
  const fault = state.ball.fault
  scorePoint(state, state.ball.dir < 0 ? 2 : 1, now)
  return fault === 'out' ? { kind: 'bad', text: '아웃! 🚀' } : { kind: 'bad', text: '네트… 🥅' }
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

function updateBallPosition(state: LocalPingPongState) {
  const ball = state.ball
  const progress = ball.dir > 0 ? clamp(ball.pos, 0, 1) : clamp(1 - ball.pos, 0, 1)
  ball.x = lerp(ball.x0, ball.x1, progress)
  trackIncomingBall(state, ball.dir, ball.x)
}

function updateFault(state: LocalPingPongState, now: number): LocalFeedback | null {
  const ball = state.ball
  const progress = flightProgress(ball.pos, ball.dir, ball.fault)
  ball.x = lerp(ball.x0, ball.x1, Math.min(1, progress))
  const end = ball.fault === 'net' ? NET_HIT_PROG : OUT_END_PROG
  return progress >= end ? faultPoint(state, now) : null
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
  if (ball.fault) return updateFault(state, now)

  updateBallPosition(state)
  if (ball.dir > 0 && ball.pos >= MISS1) return scorePoint(state, 2, now)
  if (ball.dir >= 0) return null
  if (state.mode === 'solo' && ball.pos <= 0) return botReturn(state, now, random)
  if (state.mode === 'duo' && ball.pos <= MISS2) return scorePoint(state, 1, now)
  return null
}

function prepareReturn(
  state: LocalPingPongState,
  player: 1 | 2,
  distance: number,
  early: boolean,
  now: number,
  random: RandomSource,
): LocalFeedback | null {
  const ball = state.ball
  ball.dir = player === 1 ? -1 : 1
  ball.hit = false
  ball.x0 = ball.x
  ball.x1 = randomBetween(0.15, 0.85, random)

  const band = state.mode === 'solo' ? BOT[state.difficulty].band : FAULT_BAND
  const fault = faultOf(distance, early, band)
  if (fault) {
    ball.fault = fault
    ball.faultFrom = flightProgress(ball.pos, ball.dir, fault)
    ball.smash = false
    ball.speed = fault === 'out' ? NORMAL_SPEED : WEAK_SPEED
    return null
  }

  state.rally += 1
  if (distance <= PERFECT_D) {
    ball.speed = SMASH_SPEED
    ball.smash = true
    state.flashAt = now
    state.shakeAt = now
    return { kind: 'smash', text: '스매시! 💥' }
  }
  if (distance <= GOOD_D) {
    ball.speed = NORMAL_SPEED
    ball.smash = false
    return { kind: 'nice', text: '퍼펙트!' }
  }
  ball.speed = WEAK_SPEED
  ball.smash = false
  return { kind: 'ok', text: '굿!' }
}

function swingP1(state: LocalPingPongState, now: number, random: RandomSource) {
  const ball = state.ball
  if (ball.dir < 0 || ball.hit) return null
  state.p1X = ball.x
  state.p1SwingAt = now
  if (ball.pos < W1_LO) return { kind: 'miss', text: '너무 빨라요' } as const
  if (ball.pos > W1_HI) return { kind: 'miss', text: '너무 늦었어요' } as const
  return prepareReturn(state, 1, Math.abs(ball.pos - IDEAL1), ball.pos < IDEAL1, now, random)
}

function swingP2(state: LocalPingPongState, now: number, random: RandomSource) {
  const ball = state.ball
  if (state.mode !== 'duo' || ball.dir > 0 || ball.hit) return null
  state.p2X = ball.x
  state.p2SwingAt = now
  if (ball.pos > W2_HI) return { kind: 'miss', text: '너무 빨라요' } as const
  if (ball.pos < W2_LO) return { kind: 'miss', text: '너무 늦었어요' } as const
  return prepareReturn(state, 2, Math.abs(ball.pos - IDEAL2), ball.pos > IDEAL2, now, random)
}

export function swingLocalGame(
  state: LocalPingPongState,
  player: 1 | 2,
  now: number,
  motion = false,
  random: RandomSource = Math.random,
): LocalFeedback | null {
  if (state.phase !== 'playing' || state.ball.fault) return null
  const lastSwing = player === 1 ? state.p1SwingAt : state.p2SwingAt
  if (!motion && now - lastSwing < SWING_LOCK_MS) return null
  return player === 1 ? swingP1(state, now, random) : swingP2(state, now, random)
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
