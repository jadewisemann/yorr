import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
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
import { createFrameClock, mountSceneLoop, type SceneLoop } from '@/pingpong/rendering/sceneLoop'
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

function tapPlayer(event: ReactPointerEvent<HTMLDivElement>, mode: LocalPingPongMode): 1 | 2 {
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

/** 타구 판정 글자(GOOD·PERFECT…). 새 판정이 오면 잠깐 띄우고 저절로 지운다. */
function useFeedbackLabel() {
  const labelTimerRef = useRef<number | null>(null)
  const [feedback, setFeedback] = useState<LocalFeedback | null>(null)

  const showFeedback = useCallback((next: LocalFeedback | null) => {
    if (!next) return
    setFeedback(next)
    if (labelTimerRef.current !== null) window.clearTimeout(labelTimerRef.current)
    labelTimerRef.current = window.setTimeout(() => setFeedback(null), FEEDBACK_MS)
  }, [])

  const cancelFeedbackTimer = useCallback(() => {
    if (labelTimerRef.current !== null) window.clearTimeout(labelTimerRef.current)
  }, [])

  return { cancelFeedbackTimer, feedback, setFeedback, showFeedback }
}

// Space는 1번, 둘이 하는 판에서는 P가 2번 라켓이다.
function useLocalSwingKeys(mode: LocalPingPongMode, swing: (player: 1 | 2) => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || (event.code !== 'Space' && event.code !== 'KeyP')) return
      event.preventDefault()
      swing(event.code === 'KeyP' && mode === 'duo' ? 2 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, swing])
}

/** 렌더 루프가 판을 진행하며 결과를 내보내는 곳. */
interface LocalLoopTargets {
  gameRef: RefObject<LocalPingPongState>
  setHud: (hud: HudState) => void
  showFeedback: (feedback: LocalFeedback | null) => void
}

/** 판을 한 프레임 진행하고 그린다. HUD는 값이 바뀐 프레임에만 React로 올린다. */
function mountLocalLoop(
  canvas: HTMLCanvasElement,
  { gameRef, setHud, showFeedback }: LocalLoopTargets,
): SceneLoop {
  const loop = mountSceneLoop(canvas, (scene) => {
    const { now, dt } = tick()
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
  })
  let shownHud = hudOf(gameRef.current)
  const tick = createFrameClock()
  return loop
}

/** 혼자 하는 판이 끝나면 결과를 한 번만 올린다. 다시 하면 새 결과 id로 바꾼다. */
function useAiResultSave(mode: LocalPingPongMode, hud: HudState) {
  const authSession = useAppStore((state) => state.authSession)
  const resultIdRef = useRef(createResultId())
  const submittedResultRef = useRef<string | null>(null)

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

  return () => {
    resultIdRef.current = createResultId()
    submittedResultRef.current = null
  }
}

export function useLocalPingPongGame({ difficulty, mode }: UseLocalPingPongGameOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<LocalPingPongState>(createLocalGame(mode, difficulty))
  const { cancelFeedbackTimer, feedback, setFeedback, showFeedback } = useFeedbackLabel()
  const [glFailed, setGlFailed] = useState(false)
  const [hud, setHud] = useState(() => hudOf(gameRef.current))

  const swing = useCallback(
    (player: 1 | 2, motion = false) => {
      showFeedback(swingLocalGame(gameRef.current, { motion, now: performance.now(), player }))
    },
    [showFeedback],
  )

  const { permission, requestPermission } = useSwing({
    enabled: hud.phase === 'playing',
    onSwing: () => swing(1, true),
  })

  useLocalSwingKeys(mode, swing)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let loop: SceneLoop
    try {
      loop = mountLocalLoop(canvas, { gameRef, setHud, showFeedback })
    } catch {
      setGlFailed(true)
      return
    }
    return () => {
      loop.stop()
      cancelFeedbackTimer()
    }
  }, [cancelFeedbackTimer, showFeedback])

  const resetResult = useAiResultSave(mode, hud)

  const restart = () => {
    restartLocalGame(gameRef.current)
    resetResult()
    setFeedback(null)
    setHud(hudOf(gameRef.current))
  }

  const onTap = (event: ReactPointerEvent<HTMLDivElement>) => {
    swing(tapPlayer(event, mode))
  }

  return { canvasRef, feedback, glFailed, hud, onTap, permission, requestPermission, restart }
}
