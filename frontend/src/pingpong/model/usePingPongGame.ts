import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Fault, flightOf, flightProgress } from '@/pingpong/domain/court'
import type { FrameState } from '@/pingpong/domain/frameState'
import { type PlayerTracking, trackIncomingBall } from '@/pingpong/domain/playerTracking'
import { followCanvasSize } from '@/pingpong/rendering/canvasResize'
import { createScene, type PingPongScene } from '@/pingpong/rendering/scene3d'
import { playRacketHit, playTableHit } from '@/pingpong/sounds'
import { useControllerLink } from '@/realtime/controllerLink/ControllerLinkContext'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type PingPongState } from '@/realtime/wsEvents'
import { useSwing } from '@/shared/useSwing'
import type { ActiveRoomSession } from '@/store'

interface UsePingPongGameOptions {
  court: boolean
  dashboard: boolean
  roomId: string
  session: ActiveRoomSession
  state: PingPongState | undefined
}

export function usePingPongGame({
  court,
  dashboard,
  roomId,
  session,
  state,
}: UsePingPongGameOptions) {
  const client = useRealtimeClient()
  const controllerLink = useControllerLink()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<PingPongScene | null>(null)
  const trackingRef = useRef({ p1X: 0.5, p2X: 0.5 })
  const stateRef = useRef(state)
  const viewerRef = useRef<1 | 2>(1)
  const inputSeq = useRef(0)
  const soundedEvent = useRef(0)
  const [clock, setClock] = useState(Date.now())
  const [sendError, setSendError] = useState<string | null>(null)

  useLayoutEffect(() => {
    stateRef.current = state
    viewerRef.current = viewerFor(state, session.you)
  })

  /**
   * 스윙은 **링크를 먼저 시도한다.** 파티 모드에서는 이 신호가 가야 할 곳이 서버가 아니라
   * 판정하는 큰 화면이고(ADR-0003), 링크가 없으면 서버가 받아 대시보드에 전달한다.
   * 일반 방·빠른 대전에는 링크가 없으므로 지금까지와 똑같이 서버로 간다.
   */
  const swing = useCallback(() => {
    if (dashboard || !canSwing(stateRef.current)) return
    const message = buildClientMessage(
      'game.ping_pong.swing',
      { inputSeq: ++inputSeq.current, clientTs: Date.now() },
      { roomId },
    )
    if (controllerLink.trySend(message)) {
      setSendError(null)
      return
    }
    try {
      client.send(message)
      setSendError(null)
    } catch {
      setSendError('연결을 확인한 뒤 다시 스윙해 주세요.')
    }
  }, [client, controllerLink, dashboard, roomId])

  const ready = useCallback(() => {
    if (dashboard || stateRef.current?.phase !== 'PREPARING') return
    try {
      client.send(buildClientMessage('game.ping_pong.ready', {}, { roomId }))
      setSendError(null)
    } catch {
      setSendError('연결을 확인한 뒤 다시 준비해 주세요.')
    }
  }, [client, dashboard, roomId])

  const { permission, requestPermission } = useSwing({
    onSwing: swing,
    enabled: canControl(dashboard, state),
  })

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 100)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'Space') return
      event.preventDefault()
      swing()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [swing])

  useEffect(() => {
    const event = state?.lastEvent
    if (!event || event.id === soundedEvent.current) return
    soundedEvent.current = event.id
    playRacketHit(event.type)
  }, [state?.lastEvent])

  useEffect(() => {
    const ball = state?.ball
    if (!ball || ball.fault || state?.phase !== 'PLAYING') return
    const elapsed = Math.max(0, Date.now() - ball.launchedAt) / 1_000
    const currentPos = ball.pos + ball.direction * ball.speed * elapsed
    const start = flightProgress(currentPos, ball.direction)
    const delay = ((flightOf(ball.smash).bounceAt - start) / ball.speed) * 1_000
    if (delay < 0) return
    const timeoutId = window.setTimeout(playTableHit, delay)
    return () => window.clearTimeout(timeoutId)
  }, [state?.ball, state?.phase])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!court || !canvas) return
    const scene = createScene(canvas)
    sceneRef.current = scene
    const stopFollowingSize = followCanvasSize(canvas, scene)

    let raf = 0
    const frame = () => {
      const current = stateRef.current
      if (current)
        renderSceneFrame(
          scene,
          current,
          viewerRef.current,
          Date.now(),
          trackingRef.current,
          dashboard,
        )
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      stopFollowingSize()
      scene.dispose()
      sceneRef.current = null
    }
  }, [court, dashboard])

  return { canvasRef, clock, permission, ready, requestPermission, sendError, swing }
}

function currentBall(state: PingPongState, now: number) {
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

function viewerFor(state: PingPongState | undefined, playerId: string): 1 | 2 {
  return state?.playerOrder.indexOf(playerId) === 1 ? 2 : 1
}

function canControl(dashboard: boolean, state: PingPongState | undefined) {
  return !dashboard && canSwing(state)
}

function canSwing(state: PingPongState | undefined) {
  return state?.phase === 'PREPARING' || state?.phase === 'PLAYING'
}

function renderSceneFrame(
  scene: PingPongScene,
  state: PingPongState,
  viewer: 1 | 2,
  now: number,
  tracking: PlayerTracking,
  split: boolean,
) {
  const rendered = createFrameState(state, viewer, now, tracking, split)
  scene.update(rendered)
  scene.render(rendered)
}

function createFrameState(
  state: PingPongState,
  viewer: 1 | 2,
  now: number,
  tracking: PlayerTracking,
  split: boolean,
): FrameState {
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
