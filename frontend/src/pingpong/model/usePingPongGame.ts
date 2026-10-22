import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createScene, type PingPongScene } from '@/pingpong/rendering/scene3d'
import { useControllerLink } from '@/realtime/controllerLink/ControllerLinkContext'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type PingPongState } from '@/realtime/wsEvents'
import { useSwing } from '@/shared/useSwing'
import type { ActiveRoomSession } from '@/store'
import {
  canControl,
  canSwing,
  renderSceneFrame,
  useRacketSound,
  useTableSound,
  viewerFor,
} from './frameState'

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

  useRacketSound(state, soundedEvent)
  useTableSound(state)

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
        renderSceneFrame({
          scene,
          state: current,
          viewer: viewerRef.current,
          now: Date.now(),
          tracking: trackingRef.current,
          split: dashboard,
        })
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
