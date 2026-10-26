import {
  flightProgress,
  NET_HIT_PROG,
  NORMAL_SPEED,
  OUT_END_PROG,
  SMASH_SPEED,
  WEAK_SPEED,
} from './court'
import { BOT } from './localBot'
import { clamp, lerp, type RandomSource, randomBetween } from './localMath'
import type { LocalFeedback, LocalPingPongState } from './localTypes'
import { trackIncomingBall } from './playerTracking'

/**
 * 로컬 탁구의 **공 이동과 봇 리턴** — 궤적 진행, 폴트 도달, 봇이 칠지 말지.
 *
 * 게임 루프(`localGame.ts`)에서 갈라 둔 이유: 루프는 점수·서브·단계 전이를 정하고,
 * 이쪽은 "공이 어디로 가고 있는가"만 계산한다. 봇 성향(`localBot.ts`)과 좌우 보간을
 * 함께 쓰므로 점수 규칙(`scorePoint`)은 콜백으로 받는다 — 순환 임포트를 만들지 않기
 * 위해서다.
 */

/** 득점 처리는 루프가 소유한다. 이 모듈은 "누가 얻었는지"만 알려 준다. */
export type ScoreSink = (state: LocalPingPongState, scorer: 1 | 2, now: number) => LocalFeedback

function botMisses(state: LocalPingPongState, random: RandomSource): boolean {
  const skill = BOT[state.difficulty]
  const ball = state.ball
  const chance = ball.smash
    ? skill.missSmash
    : skill.missNormal + Math.min(skill.rampCap, state.rally * skill.ramp)
  return random() < chance
}

function setBotFault(state: LocalPingPongState, random: RandomSource): void {
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

/** 솔로 모드의 봇(P2)이 공을 받는다. 득점이면 피드백, 아니면 null. */
export function botReturn(
  state: LocalPingPongState,
  now: number,
  random: RandomSource,
  score: ScoreSink,
): LocalFeedback | null {
  const skill = BOT[state.difficulty]
  const ball = state.ball
  state.p2SwingAt = now

  if (botMisses(state, random)) {
    if (random() < 0.5) return score(state, 1, now)
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

/** 공 진행과 같은 속도 기반 좌우 보간. 봇/상대 추적도 함께 갱신한다. */
export function updateBallPosition(state: LocalPingPongState): void {
  const ball = state.ball
  const progress = ball.dir > 0 ? clamp(ball.pos, 0, 1) : clamp(1 - ball.pos, 0, 1)
  ball.x = lerp(ball.x0, ball.x1, progress)
  trackIncomingBall(state, ball.dir, ball.x)
}

/** 폴트 공이 끝(네트/아웃)에 닿았는가. 닿았으면 득점 피드백을 돌려준다. */
export function updateFault(
  state: LocalPingPongState,
  now: number,
  score: ScoreSink,
): LocalFeedback | null {
  const ball = state.ball
  const progress = flightProgress(ball.pos, ball.dir, ball.fault)
  ball.x = lerp(ball.x0, ball.x1, Math.min(1, progress))
  const end = ball.fault === 'net' ? NET_HIT_PROG : OUT_END_PROG
  if (progress < end) return null
  const fault = ball.fault
  score(state, ball.dir < 0 ? 2 : 1, now)
  return fault === 'out' ? { kind: 'bad', text: '아웃! 🚀' } : { kind: 'bad', text: '네트… 🥅' }
}

/** 랠리가 길어질수록 공이 빨라진다 — 양쪽 점수 합에 비례한다. */
export const baseSpeed = (state: LocalPingPongState): number =>
  NORMAL_SPEED + Math.min(0.35, (state.s1 + state.s2) * 0.02)
