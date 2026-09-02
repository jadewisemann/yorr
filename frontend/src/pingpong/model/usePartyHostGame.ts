import { useCallback, useEffect, useRef, useState } from 'react'
import { playerNumberOf, toPingPongState } from '@/pingpong/domain/hostState'
import {
  advanceLocalGame,
  createLocalGame,
  type LocalPingPongState,
  localFrameState,
  swingLocalGame,
} from '@/pingpong/domain/localGame'
import { followCanvasSize } from '@/pingpong/rendering/canvasResize'
import { createScene, type PingPongScene } from '@/pingpong/rendering/scene3d'
import { useRealtimeClient } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type PingPongState } from '@/realtime/wsEvents'

/**
 * 파티 모드 탁구에서 **대시보드가 랠리를 판정한다**(ADR-0003).
 *
 * 판정과 렌더가 같은 기기에 있으므로 공이 방향을 바꾸는 순간에 지연이 없다. 서버로는
 * 결과 상태만 올리고(`game.ping_pong.host_state`), 폰의 점수판은 그것이 방송돼 채운다.
 *
 * 입력은 두 경로로 들어오지만 **봉투가 같다**: 링크로 온 스윙은 `relayedServerMessage`가,
 * 링크가 없는 스윙은 서버가 `game.ping_pong.swung`으로 만든다. 그래서 여기서는 한 갈래만
 * 본다.
 */

/** 상태 보고 주기. 폰의 점수판은 한 왕복 늦어도 되므로 촘촘할 이유가 없다. */
const REPORT_INTERVAL_MS = 500

interface UsePartyHostGameOptions {
  /** 이 기기가 판정하는가. 대시보드가 아니면 시뮬레이션도 3D 무대도 만들지 않는다. */
  enabled: boolean
  roomId: string
  /** 서버가 만든 초기 상태. `playerOrder`가 로컬 1·2번의 유일한 근거다. */
  base: PingPongState | undefined
}

export function usePartyHostGame({ base, enabled, roomId }: UsePartyHostGameOptions) {
  const client = useRealtimeClient()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<LocalPingPongState | null>(null)
  const baseRef = useRef<PingPongState | undefined>(base)
  const versionRef = useRef(0)
  const reportedAtRef = useRef(0)
  const [hostState, setHostState] = useState<PingPongState | undefined>(undefined)

  baseRef.current = base

  /**
   * 서버가 준비 게이트를 끝내면(PREPARING을 벗어나면) 그때부터 대시보드가 판을 잡는다.
   * 이음매를 여기 둔 이유는 서버가 `playerOrder`를 만드는 자리이기 때문이다.
   */
  const started = enabled && base !== undefined && base.phase !== 'PREPARING'
  useEffect(() => {
    if (!started) {
      gameRef.current = null
      return
    }
    if (gameRef.current) return
    gameRef.current = createLocalGame('duo', 'normal')
    versionRef.current = base?.version ?? 0
  }, [base?.version, started])

  const report = useCallback(
    (game: LocalPingPongState, now: number, force: boolean) => {
      const current = baseRef.current
      if (!current) return
      if (!force && now - reportedAtRef.current < REPORT_INTERVAL_MS) return
      reportedAtRef.current = now
      versionRef.current += 1
      const next = toPingPongState({
        base: current,
        local: game,
        version: versionRef.current,
        now: Date.now(),
        countdownMs: game.nextServeAt - now,
      })
      setHostState(next)
      try {
        client.send(buildClientMessage('game.ping_pong.host_state', next, { roomId }))
      } catch {}
    },
    [client, roomId],
  )

  // 두 경로의 스윙이 같은 봉투로 도착한다. 판정하지 않는 기기는 구독하지 않는다.
  useEffect(() => {
    if (!enabled) return
    return client.onMessage((message) => {
      if (message.type !== 'game.ping_pong.swung') return
      const game = gameRef.current
      const current = baseRef.current
      if (!game || !current) return
      const player = playerNumberOf(current, message.payload.playerId)
      if (!player) return
      swingLocalGame(game, player, performance.now(), true)
    })
  }, [client, enabled])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !started) return
    let scene: PingPongScene
    try {
      scene = createScene(canvas)
    } catch {
      return
    }

    const stopFollowingSize = followCanvasSize(canvas, scene)

    let last = performance.now()
    let shownPhase: LocalPingPongState['phase'] | null = null
    let raf = 0
    const frame = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1_000)
      last = now
      const game = gameRef.current
      if (game) {
        advanceLocalGame(game, now, dt)
        // 국면이 바뀐 순간(득점·서브·종료)은 즉시 올린다 — 주기를 기다리면 폰의 점수판이
        // 결과보다 늦게 바뀐다.
        report(game, now, game.phase !== shownPhase)
        shownPhase = game.phase
        const frameState = localFrameState(game, now)
        scene.update(frameState)
        scene.render(frameState)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      stopFollowingSize()
      scene.dispose()
    }
  }, [report, started])

  return { canvasRef, hostState }
}
