import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { savePingPongAiResult } from '@/pingpong/api/pingPongAiResultApi'
import {
  advanceLocalGame,
  createLocalGame,
  type LocalFeedback,
  type LocalPingPongDifficulty,
  type LocalPingPongMode,
  type LocalPingPongState,
  localFrameState,
  restartLocalGame,
  swingLocalGame,
} from '@/pingpong/domain/localGame'
import { followCanvasSize } from '@/pingpong/rendering/canvasResize'
import { createScene, type PingPongScene } from '@/pingpong/rendering/scene3d'
import { useSwing } from '@/shared/useSwing'
import { useAppStore } from '@/store'

export interface HudState {
  countdown: number
  phase: LocalPingPongState['phase']
  rally: number
  s1: number
  s2: number
}

function hudOf(game: LocalPingPongState): HudState {
  return {
    countdown: game.countdown,
    phase: game.phase,
    rally: game.rally,
    s1: game.s1,
    s2: game.s2,
  }
}

function sameHud(left: HudState, right: HudState) {
  return (
    left.countdown === right.countdown &&
    left.phase === right.phase &&
    left.rally === right.rally &&
    left.s1 === right.s1 &&
    left.s2 === right.s2
  )
}

/**
 * 탭에서 필요한 것은 누른 x좌표와 그것을 받은 요소뿐이다. 이만큼만 요구하면 검사가 진짜
 * 포인터 이벤트를 지어내지 않아도 되고, JSX의 `onPointerDown`에는 그대로 걸린다.
 */
export type TapPoint = Pick<ReactPointerEvent<HTMLElement>, 'clientX' | 'currentTarget'>

function tapPlayer(event: TapPoint, mode: LocalPingPongMode): 1 | 2 {
  if (mode !== 'duo') return 1
  const bounds = event.currentTarget.getBoundingClientRect()
  return event.clientX - bounds.left < bounds.width / 2 ? 1 : 2
}

function createResultId() {
  return globalThis.crypto.randomUUID()
}

const FEEDBACK_MS = 850

interface UseLocalPingPongGameOptions {
  difficulty: LocalPingPongDifficulty
  mode: LocalPingPongMode
}

export function useLocalPingPongGame({ difficulty, mode }: UseLocalPingPongGameOptions) {
  const authSession = useAppStore((state) => state.authSession)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<LocalPingPongState>(createLocalGame(mode, difficulty))
  const resultIdRef = useRef(createResultId())
  const submittedResultRef = useRef<string | null>(null)
  const labelTimerRef = useRef<number | null>(null)
  const [feedback, setFeedback] = useState<LocalFeedback | null>(null)
  const [glFailed, setGlFailed] = useState(false)
  const [hud, setHud] = useState(() => hudOf(gameRef.current))

  const showFeedback = useCallback((next: LocalFeedback | null) => {
    if (!next) return
    setFeedback(next)
    if (labelTimerRef.current !== null) window.clearTimeout(labelTimerRef.current)
    labelTimerRef.current = window.setTimeout(() => setFeedback(null), FEEDBACK_MS)
  }, [])

  const swing = useCallback(
    (player: 1 | 2, motion = false) => {
      showFeedback(swingLocalGame(gameRef.current, player, performance.now(), motion))
    },
    [showFeedback],
  )

  const { permission, requestPermission } = useSwing({
    enabled: hud.phase === 'playing',
    onSwing: () => swing(1, true),
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || (event.code !== 'Space' && event.code !== 'KeyP')) return
      event.preventDefault()
      swing(event.code === 'KeyP' && mode === 'duo' ? 2 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, swing])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let scene: PingPongScene
    try {
      scene = createScene(canvas)
    } catch {
      setGlFailed(true)
      return
    }

    const stopFollowingSize = followCanvasSize(canvas, scene)

    let shownHud = hudOf(gameRef.current)
    let last = performance.now()
    let raf = 0
    const frame = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1_000)
      last = now
      const game = gameRef.current
      showFeedback(advanceLocalGame(game, now, dt))
      const nextHud = hudOf(game)
      if (!sameHud(shownHud, nextHud)) {
        shownHud = nextHud
        setHud(nextHud)
      }
      const frameState = localFrameState(game, now)
      scene.update(frameState)
      scene.render(frameState)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      stopFollowingSize()
      scene.dispose()
      if (labelTimerRef.current !== null) window.clearTimeout(labelTimerRef.current)
    }
  }, [showFeedback])

  const saveResult = useCallback(() => {
    if (mode !== 'solo' || hud.phase !== 'over') return
    const resultId = resultIdRef.current
    if (submittedResultRef.current === resultId) return
    submittedResultRef.current = resultId
    void savePingPongAiResult(authSession?.sessionToken ?? null, {
      resultId,
      humanScore: hud.s1,
      aiScore: hud.s2,
    }).catch(() => {})
  }, [authSession, hud.phase, hud.s1, hud.s2, mode])

  useEffect(() => saveResult(), [saveResult])

  const restart = () => {
    restartLocalGame(gameRef.current)
    resultIdRef.current = createResultId()
    submittedResultRef.current = null
    setFeedback(null)
    setHud(hudOf(gameRef.current))
  }

  const onTap = (event: TapPoint) => {
    swing(tapPlayer(event, mode))
  }

  return { canvasRef, feedback, glFailed, hud, onTap, permission, requestPermission, restart }
}
