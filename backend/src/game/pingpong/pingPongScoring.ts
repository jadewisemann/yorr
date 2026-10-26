import {
  ballAt,
  missDeadline,
  NORMAL_SPEED,
  POINT_COUNTDOWN_MILLIS,
  WIN_SCORE,
} from './pingPongCourtMath.js'
import type {
  PingPongBall,
  PingPongDirection,
  PingPongEvent,
  PingPongEventType,
  PingPongPhase,
  PingPongPlayerNumbers,
  PingPongState,
} from './pingPongState.js'

/**
 * 탁구의 **득점·서브·종료** — 시계가 넘기는 쪽 전이만 모은 파일.
 *
 * `pingPongRules.ts`가 "입력이 오면 상태가 어떻게 바뀌는가"(ready·swing)를 맡는다면
 * 여기는 "공이 도착했거나 사람이 나갔을 때 누가 점수를 얻는가"를 맡는다. 같은 상태
 * 기계를 두 관심사로 가른 것이라 서로를 import하지 않는다 — 둘 다 순수 함수다.
 *
 * 궤적·판정 창의 정본은 `pingPongCourtMath.ts`다.
 */

/** playerOrder 안의 좌석. 없으면 -1. */
const seatOf = (state: PingPongState, playerId: string): number =>
  state.playerOrder.indexOf(playerId)

const event = (
  version: number,
  type: PingPongEventType,
  playerId: string,
  now: number,
): PingPongEvent => ({ id: version, type, playerId, at: now })

/**
 * 실제 탁구의 서브 교대 규칙. 상태가 서브권이 아니라 **"다음 서브를 받을 사람"**
 * 을 저장하므로 같은 인덱스를 2점 동안 유지한 뒤 바꾼다. 10:10(합계 20)부터는
 * 매 점마다 바뀐다.
 */
export const serveReceiver = (
  playerOrder: readonly string[],
  scores: PingPongPlayerNumbers,
): string => {
  const first = scores[playerOrder[0] as string] ?? 0
  const second = scores[playerOrder[1] as string] ?? 0
  const total = first + second
  const serviceTurn = total < 20 ? Math.floor(total / 2) : 10 + (total - 20)
  return playerOrder[serviceTurn % 2] as string
}

/**
 * 카운트다운 만료 → 서브. 공은 리시버의 **반대쪽 끝**에서 출발한다.
 * @param targetX 좌우 목표점(서버 RNG). 클라이언트가 정하지 않는다.
 */
export const serve = (state: PingPongState, now: number, targetX: number): PingPongState => {
  if (state.phase !== 'COUNTDOWN') return state
  const receiver = state.playerOrder.indexOf(state.serveReceiverId ?? '')
  const direction: PingPongDirection = receiver === 0 ? 1 : -1
  const ball: PingPongBall = {
    pos: direction > 0 ? 0 : 1,
    direction,
    speed: NORMAL_SPEED,
    smash: false,
    faultFrom: 0,
    x0: 0.5,
    x1: targetX,
    launchedAt: now,
  }
  const version = state.version + 1
  return {
    ...state,
    version,
    phase: 'PLAYING',
    ball,
    rally: 0,
    nextActionAt: missDeadline(ball, now),
    lastEvent: event(version, 'SERVE', state.serveReceiverId as string, now),
  }
}

/**
 * 마감. 폴트 공은 **친 쪽의 상대**가 득점하고(공이 상대에게 가던 중이므로
 * direction으로 되짚는다), 폴트 없는 공은 **받지 못한 쪽의 상대**가 득점한다.
 */
export const expire = (state: PingPongState, now: number): PingPongState => {
  if (state.phase !== 'PLAYING') return state
  const ball = ballAt(state.ball, now)
  const scorer =
    ball.fault !== undefined ? (ball.direction < 0 ? 1 : 0) : ball.direction > 0 ? 1 : 0
  return point(state, scorer, ball, now)
}

/**
 * 이탈 몰수 — 남은 사람이 {@link WIN_SCORE}로 즉시 이긴다.
 * **PREPARING 중 이탈은 이 경로로 오지 않는다**(시작도 안 한 매치를 이겼다고 주지
 * 않는다 — `pingPongGameService.ts`의 취소 시퀀스).
 */
export const forfeit = (state: PingPongState, playerId: string, now: number): PingPongState => {
  const loser = seatOf(state, playerId)
  if (loser < 0 || state.phase === 'FINISHED') return state
  const winnerId = state.playerOrder[loser === 0 ? 1 : 0] as string
  const version = state.version + 1
  return {
    ...state,
    version,
    phase: 'FINISHED',
    scores: { ...state.scores, [winnerId]: WIN_SCORE },
    serveReceiverId: undefined,
    nextActionAt: 0,
    lastEvent: event(version, 'OPPONENT_LEFT', winnerId, now),
  }
}

/** 11점 선취 + **2점 차**(듀스). 아니면 다음 서브를 위한 COUNTDOWN으로 되돌아간다. */
const point = (
  state: PingPongState,
  scorer: number,
  ball: PingPongBall,
  now: number,
): PingPongState => {
  const scorerId = state.playerOrder[scorer] as string
  const score = (state.scores[scorerId] ?? 0) + 1
  const scores: Record<string, number> = { ...state.scores, [scorerId]: score }
  const opponentScore = scores[state.playerOrder[scorer === 0 ? 1 : 0] as string] ?? 0
  const version = state.version + 1
  const finished = score >= WIN_SCORE && score - opponentScore >= 2
  const phase: PingPongPhase = finished ? 'FINISHED' : 'COUNTDOWN'
  return {
    ...state,
    version,
    phase,
    scores,
    ball,
    serveReceiverId: finished ? undefined : serveReceiver(state.playerOrder, scores),
    nextActionAt: finished ? 0 : now + POINT_COUNTDOWN_MILLIS,
    lastEvent: event(version, finished ? 'GAME_OVER' : 'POINT', scorerId, now),
  }
}
