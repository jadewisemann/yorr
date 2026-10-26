import {
  FAULT_BAND,
  faultOf,
  flightProgress,
  GOOD_D,
  IDEAL1,
  IDEAL2,
  NORMAL_SPEED,
  PERFECT_D,
  SMASH_SPEED,
  W1_HI,
  W1_LO,
  W2_HI,
  W2_LO,
  WEAK_SPEED,
} from './court'
import { BOT } from './localBot'
import type { LocalFeedback, LocalPingPongState } from './localGame'
import { type RandomSource, randomBetween } from './localMath'
import { swingQualityOf } from './swingQuality'

/**
 * 로컬 탁구의 **스윙 판정** — 창 안/밖 판정, 폴트, 리턴 속도·방향.
 *
 * 게임 루프(`localGame.ts`)에서 갈라 둔 이유: 루프는 공의 이동·득점·서브를
 * 진행하고, 이쪽은 "사람(또는 봇)이 지금 쳤을 때 무슨 일이 나는가"만 안다.
 * 판정 창 상수를 조정할 때 루프를 지나치지 않게 한다.
 */

/** 스윙 연출 길이 — 잠금과 같은 값이지만 뜻이 다르다(연출 vs 입력 무시). */
export const SWING_MS = 260
export const SWING_LOCK_MS = 260

interface ReturnShot {
  player: 1 | 2
  /** 이상적인 타격 지점과의 거리. */
  distance: number
  /** 공이 아직 이상 지점에 오기 전에 쳤는가. */
  early: boolean
  now: number
  random: RandomSource
}

export function prepareReturn(state: LocalPingPongState, shot: ReturnShot): LocalFeedback | null {
  const { player, distance, early, now, random } = shot
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
  const quality = swingQualityOf(distance, { good: GOOD_D, perfect: PERFECT_D })
  if (quality.kind === 'smash') {
    ball.speed = SMASH_SPEED
    ball.smash = true
    state.flashAt = now
    state.shakeAt = now
    return quality
  }
  ball.smash = false
  ball.speed = quality.kind === 'nice' ? NORMAL_SPEED : WEAK_SPEED
  return quality
}

function swingP1(state: LocalPingPongState, now: number, random: RandomSource) {
  const ball = state.ball
  if (ball.dir < 0 || ball.hit) return null
  state.p1X = ball.x
  state.p1SwingAt = now
  if (ball.pos < W1_LO) return { kind: 'miss', text: '너무 빨라요' } as const
  if (ball.pos > W1_HI) return { kind: 'miss', text: '너무 늦었어요' } as const
  return prepareReturn(state, {
    distance: Math.abs(ball.pos - IDEAL1),
    early: ball.pos < IDEAL1,
    now,
    player: 1,
    random,
  })
}

function swingP2(state: LocalPingPongState, now: number, random: RandomSource) {
  const ball = state.ball
  if (state.mode !== 'duo' || ball.dir > 0 || ball.hit) return null
  state.p2X = ball.x
  state.p2SwingAt = now
  if (ball.pos > W2_HI) return { kind: 'miss', text: '너무 빨라요' } as const
  if (ball.pos < W2_LO) return { kind: 'miss', text: '너무 늦었어요' } as const
  return prepareReturn(state, {
    distance: Math.abs(ball.pos - IDEAL2),
    early: ball.pos > IDEAL2,
    now,
    player: 2,
    random,
  })
}

export interface LocalSwing {
  player: 1 | 2
  now: number
  /** 모션 입력은 스윙 잠금을 무시한다(제스처가 이미 한 번만 발생한다). */
  motion?: boolean
  random?: RandomSource
}

export function swingLocalGame(state: LocalPingPongState, swing: LocalSwing): LocalFeedback | null {
  const { player, now, motion = false, random = Math.random } = swing
  if (state.phase !== 'playing' || state.ball.fault) return null
  const lastSwing = player === 1 ? state.p1SwingAt : state.p2SwingAt
  if (!motion && now - lastSwing < SWING_LOCK_MS) return null
  return player === 1 ? swingP1(state, now, random) : swingP2(state, now, random)
}
