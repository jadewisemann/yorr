import { useEffect } from 'react'
import { type Fault, flightOf, flightProgress } from '@/pingpong/domain/court'
import type { FrameState } from '@/pingpong/domain/frameState'
import { type PlayerTracking, trackIncomingBall } from '@/pingpong/domain/playerTracking'
import type { PingPongScene } from '@/pingpong/rendering/scene3d'
import { playRacketHit, playTableHit } from '@/pingpong/sounds'
import type { PingPongState } from '@/realtime/wsEvents'

/** 현재 시각 기준의 공 위치. 서버는 발사 시점만 주고 진행은 클라이언트가 보간한다. */
export function currentBall(state: PingPongState, now: number) {
  const source = state.ball
  const elapsed = state.phase === 'PLAYING' ? Math.max(0, now - source.launchedAt) / 1_000 : 0
  const pos = source.pos + source.direction * source.speed * elapsed
  const progress = Math.max(0, Math.min(1, source.direction > 0 ? pos : 1 - pos))
  return {
    ...source,
    pos,
    x: source.x0 + (source.x1 - source.x0) * progress,
    faultFrom: source.fault ? source.faultFrom : flightProgress(pos, source.direction),
  }
}

export function viewerFor(state: PingPongState | undefined, playerId: string): 1 | 2 {
  return state?.playerOrder.indexOf(playerId) === 1 ? 2 : 1
}

export function canControl(dashboard: boolean, state: PingPongState | undefined) {
  return !dashboard && canSwing(state)
}

export function canSwing(state: PingPongState | undefined) {
  return state?.phase === 'PREPARING' || state?.phase === 'PLAYING'
}

/** 한 프레임을 그리는 데 필요한 것. 렌더 루프가 이 묶음을 그대로 넘긴다. */
export interface FrameRequest {
  scene: PingPongScene
  state: PingPongState
  viewer: 1 | 2
  now: number
  tracking: PlayerTracking
  split: boolean
}

export function renderSceneFrame(request: FrameRequest) {
  const rendered = createFrameState(request)
  request.scene.update(rendered)
  request.scene.render(rendered)
}

export function createFrameState({
  state,
  viewer,
  now,
  tracking,
  split,
}: Omit<FrameRequest, 'scene'>): FrameState {
  const ball = currentBall(state, now)
  trackIncomingBall(tracking, ball.direction, ball.x)
  const eventAge = state.lastEvent ? now - state.lastEvent.at : Number.POSITIVE_INFINITY
  const swingAmount = eventAge < 260 ? 1 - eventAge / 260 : 0
  const eventPlayer = state.lastEvent?.playerId
  const fault = ball.fault?.toLowerCase() as Fault | undefined
  const falling = state.phase === 'COUNTDOWN' && ball.fault && state.lastEvent
  return {
    split,
    viewer,
    playing: state.phase === 'PLAYING',
    ballPos: ball.pos,
    ballDir: ball.direction,
    ballX: ball.x,
    ballSmash: ball.smash,
    ballHit: false,
    ballFault: fault ?? null,
    ballFaultFrom: ball.faultFrom,
    ballFall: falling ? Math.min(1.2, eventAge / 1_000) : 0,
    p1X: tracking.p1X,
    p2X: tracking.p2X,
    p1Swing: eventPlayer === state.playerOrder[0] ? swingAmount : 0,
    p2Swing: eventPlayer === state.playerOrder[1] ? swingAmount : 0,
    shake: state.lastEvent?.type === 'SMASH' && eventAge < 190 ? 1 - eventAge / 190 : 0,
  }
}

/** 이벤트마다 라켓 소리를 한 번씩. 같은 이벤트 id는 다시 울리지 않는다. */
export function useRacketSound(state: PingPongState | undefined, lastSounded: { current: number }) {
  const event = state?.lastEvent
  useEffect(() => {
    if (!event || event.id === lastSounded.current) return
    lastSounded.current = event.id
    playRacketHit(event.type)
  }, [event, lastSounded])
}

/** 공이 테이블에 닿는 시각에 맞춰 타구 소리를 예약한다. */
export function useTableSound(state: PingPongState | undefined) {
  const ball = state?.ball
  const phase = state?.phase
  useEffect(() => {
    if (!ball || ball.fault || phase !== 'PLAYING') return
    const elapsed = Math.max(0, Date.now() - ball.launchedAt) / 1_000
    const currentPos = ball.pos + ball.direction * ball.speed * elapsed
    const start = flightProgress(currentPos, ball.direction)
    const delay = ((flightOf(ball.smash).bounceAt - start) / ball.speed) * 1_000
    if (delay < 0) return
    const timeoutId = window.setTimeout(playTableHit, delay)
    return () => window.clearTimeout(timeoutId)
  }, [ball, phase])
}
