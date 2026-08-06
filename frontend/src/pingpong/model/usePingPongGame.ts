import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Fault, flightOf, flightProgress } from '@/pingpong/domain/court'
import type { FrameState } from '@/pingpong/domain/frameState'
import { type PlayerTracking, trackIncomingBall } from '@/pingpong/domain/playerTracking'
import { eventVibration } from '@/pingpong/feedback'
import { createScene, type PingPongScene } from '@/pingpong/rendering/scene3d'
import { playRacketHit, playTableHit } from '@/pingpong/sounds'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type PingPongState } from '@/realtime/wsEvents'
import { useSwing } from '@/shared/useSwing'
import { vibrate } from '@/shared/vibrate'
import type { ActiveRoomSession } from '@/store'

interface UsePingPongGameOptions {
  /** 3D 코트를 띄우는 화면인가 = canvas 가 마운트되는가. */
  court: boolean
  /** 대시보드는 조작하지 않고 양쪽을 함께 비춘다(split). */
  dashboard: boolean
  roomId: string
  session: ActiveRoomSession
  state: PingPongState | undefined
}

/**
 * 실시간 탁구 한 판의 수명주기 — 3D 장면, 프레임 루프, 입력(스페이스·탭·폰 스윙),
 * 타구·테이블 효과음, 스윙·준비 전송.
 *
 * 판정은 서버가 한다. 이 훅은 입력을 올리고 서버가 준 상태를 렌더러가 이해하는
 * `FrameState` 로 번역한다.
 */
export function usePingPongGame({
  court,
  dashboard,
  roomId,
  session,
  state,
}: UsePingPongGameOptions) {
  const client = useRealtimeClient()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<PingPongScene | null>(null)
  const trackingRef = useRef({ p1X: 0.5, p2X: 0.5 })
  const stateRef = useRef(state)
  const viewerRef = useRef<1 | 2>(1)
  const inputSeq = useRef(0)
  const soundedEvent = useRef(0)
  const [clock, setClock] = useState(Date.now())
  const [sendError, setSendError] = useState<string | null>(null)

  // 렌더 중에 ref를 쓰지 않는다 — 버려지는 렌더(동시성)에서 커밋되지 않은 값이 남는다.
  // layout effect는 페인트 전에 돌아서 이벤트·rAF가 읽는 시점에는 이미 최신이다.
  useLayoutEffect(() => {
    stateRef.current = state
    viewerRef.current = viewerFor(state, session.you)
  })

  const swing = useCallback(() => {
    if (dashboard || !canSwing(stateRef.current)) return
    try {
      client.send(
        buildClientMessage(
          'game.ping_pong.swing',
          { inputSeq: ++inputSeq.current, clientTs: Date.now() },
          { roomId },
        ),
      )
      setSendError(null)
    } catch {
      setSendError('연결을 확인한 뒤 다시 스윙해 주세요.')
    }
  }, [client, dashboard, roomId])

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
    // 소리는 코트 전체가 듣지만 진동은 <b>친 사람 손</b>에만 온다. 상대 타구까지 울리면
    // 랠리 내내 폰이 떨어서 내 스윙이 묻히고, 대시보드는 애초에 아무의 손도 아니다.
    if (event.playerId !== session.you) return
    const pattern = eventVibration(event.type)
    if (pattern !== undefined) vibrate(pattern)
  }, [state?.lastEvent, session.you])

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

  // court를 보는 이유: canvas는 코트 화면에서만 마운트된다. 창을 좁혀 폰 컨트롤러로 바뀌면
  // canvas가 사라지는데, 그때 이 effect가 다시 돌지 않으면 씬이 떨어져 나간 canvas에
  // 계속 프레임을 그린다. dashboard는 split 화면(둘 다 비추기) 여부다.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!court || !canvas) return
    const scene = createScene(canvas)
    sceneRef.current = scene
    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      scene.resize(bounds.width, bounds.height, Math.min(window.devicePixelRatio || 1, 2))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

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
      observer.disconnect()
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
