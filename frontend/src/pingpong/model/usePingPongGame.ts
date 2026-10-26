import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PingPongScene } from '@/pingpong/rendering/scene3d'
import { mountSceneLoop } from '@/pingpong/rendering/sceneLoop'
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

/** 이벤트 경로와 렌더 루프가 읽는 최신 값. 렌더마다 layout effect가 맞춰 둔다. */
interface LiveRefs {
  stateRef: RefObject<PingPongState | undefined>
  viewerRef: RefObject<1 | 2>
}

interface CommandOptions {
  dashboard: boolean
  roomId: string
  stateRef: LiveRefs['stateRef']
}

/** 스윙·준비 전송. 실패하면 다시 해 보라는 안내를 남기고, 성공하면 지운다. */
function usePingPongCommands({ dashboard, roomId, stateRef }: CommandOptions) {
  const client = useRealtimeClient()
  const controllerLink = useControllerLink()
  const inputSeq = useRef(0)
  const [sendError, setSendError] = useState<string | null>(null)

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
  }, [client, controllerLink, dashboard, roomId, stateRef])

  const ready = useCallback(() => {
    if (dashboard || stateRef.current?.phase !== 'PREPARING') return
    try {
      client.send(buildClientMessage('game.ping_pong.ready', {}, { roomId }))
      setSendError(null)
    } catch {
      setSendError('연결을 확인한 뒤 다시 준비해 주세요.')
    }
  }, [client, dashboard, roomId, stateRef])

  return { ready, sendError, swing }
}

interface CourtOptions extends LiveRefs {
  canvasRef: RefObject<HTMLCanvasElement | null>
  court: boolean
  dashboard: boolean
}

/** 코트를 보여 주는 화면이면 3D 무대를 세우고 서버 상태를 매 프레임 그린다. */
function useCourtScene({ canvasRef, court, dashboard, stateRef, viewerRef }: CourtOptions) {
  const sceneRef = useRef<PingPongScene | null>(null)
  const trackingRef = useRef({ p1X: 0.5, p2X: 0.5 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!court || !canvas) return
    const loop = mountSceneLoop(canvas, (scene) => {
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
    })
    sceneRef.current = loop.scene
    return () => {
      loop.stop()
      sceneRef.current = null
    }
  }, [canvasRef, court, dashboard, stateRef, viewerRef])
}

export function usePingPongGame({
  court,
  dashboard,
  roomId,
  session,
  state,
}: UsePingPongGameOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  const viewerRef = useRef<1 | 2>(1)
  const soundedEvent = useRef(0)
  const [clock, setClock] = useState(Date.now())

  useLayoutEffect(() => {
    stateRef.current = state
    viewerRef.current = viewerFor(state, session.you)
  })

  const { ready, sendError, swing } = usePingPongCommands({ dashboard, roomId, stateRef })
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
  useCourtScene({ canvasRef, court, dashboard, stateRef, viewerRef })

  return { canvasRef, clock, permission, ready, requestPermission, sendError, swing }
}
