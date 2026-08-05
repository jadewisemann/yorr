import { useNavigate } from '@tanstack/react-router'
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Button } from '@/shared/components/Button'
import { IconBack } from '@/shared/components/Icon'
import { useSwing } from '@/shared/useSwing'
import { useAppStore } from '@/store'
import { pingPongSituation, sharedSituationLabel } from './feedback'
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
} from './localGame'
import { savePingPongAiResult } from './pingPongAiResultApi'
import { createScene, type PingPongScene } from './scene3d'

export function PingPongModePage() {
  const navigate = useNavigate()
  return (
    <LocalPingPongGame difficulty="normal" mode="solo" onExit={() => void navigate({ to: '/' })} />
  )
}

interface HudState {
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

function localSituationLabel(hud: HudState, firstLabel: string, secondLabel: string) {
  if (hud.phase !== 'point') return null
  return sharedSituationLabel(pingPongSituation(hud.s1, hud.s2), firstLabel, secondLabel)
}

function localTapPlayer(event: ReactPointerEvent<HTMLDivElement>, mode: LocalPingPongMode): 1 | 2 {
  if (mode !== 'duo') return 1
  const bounds = event.currentTarget.getBoundingClientRect()
  return event.clientX - bounds.left < bounds.width / 2 ? 1 : 2
}

function LocalFeedbackMessage({
  feedback,
  situationLabel,
}: {
  feedback: LocalFeedback | null
  situationLabel: string | null
}) {
  if (!feedback && !situationLabel) return null
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <strong
        className={`text-4xl font-black drop-shadow-2xl ${feedback ? feedbackClass(feedback.kind) : 'text-[#ffd24a]'}`}
      >
        {feedback?.text ?? situationLabel}
      </strong>
    </div>
  )
}

function LocalPingPongGame({
  difficulty,
  mode,
  onExit,
}: {
  difficulty: LocalPingPongDifficulty
  mode: LocalPingPongMode
  onExit: () => void
}) {
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
    labelTimerRef.current = window.setTimeout(() => setFeedback(null), 850)
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

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      scene.resize(bounds.width, bounds.height, Math.min(window.devicePixelRatio || 1, 2))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

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
      observer.disconnect()
      scene.dispose()
      if (labelTimerRef.current !== null) window.clearTimeout(labelTimerRef.current)
    }
  }, [showFeedback])

  const saveResult = useCallback(() => {
    if (mode !== 'solo' || hud.phase !== 'over' || !authSession) return
    const resultId = resultIdRef.current
    if (submittedResultRef.current === resultId) return
    submittedResultRef.current = resultId
    void savePingPongAiResult(authSession.sessionToken, {
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

  const onTap = (event: ReactPointerEvent<HTMLDivElement>) => {
    swing(localTapPlayer(event, mode))
  }

  const p1Label = mode === 'solo' ? 'YOU' : 'P1'
  const p2Label = mode === 'solo' ? 'CPU' : 'P2'
  const situationLabel = localSituationLabel(hud, p1Label, p2Label)

  return (
    <main className="relative flex h-svh w-full flex-col overflow-hidden bg-[#070b12] text-white">
      <header className="relative z-20 flex flex-none items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <button
          className="flex min-h-11 items-center gap-1.5 rounded-full border border-white/15 bg-white/6 px-4 text-sm text-white/75"
          onClick={onExit}
          type="button"
        >
          {/* 꺾쇠는 공용 아이콘이다 — 문자 `‹`는 폰트마다 폭·중심이 달라 글자와 어긋난다
              (Icon.tsx 주석. 닉네임·초대 오류 화면의 뒤로 가기와 같은 그림이 된다). */}
          <IconBack className="size-4" />
          게임 선택
        </button>
        <span className="font-mono text-xs tracking-[0.14em] text-white/45">
          {mode === 'solo' ? 'AI와 대전' : '1:1 파티 모드'}
        </span>
        {permission === 'unknown' ? (
          <button
            className="min-h-11 rounded-full border border-[#49e08a]/40 bg-[#49e08a]/12 px-3 text-xs font-bold text-[#8dffc0]"
            onClick={() => void requestPermission()}
            type="button"
          >
            폰 스윙
          </button>
        ) : (
          <span className="min-w-20 text-right text-xs text-[#49e08a]">스윙 ON</span>
        )}
      </header>

      <section className="relative z-10 flex flex-none items-end justify-center gap-7 pb-2">
        <LocalScore label={p1Label} score={hud.s1} tone="blue" />
        <span className="pb-1 text-2xl text-white/30">:</span>
        <LocalScore label={p2Label} score={hud.s2} tone="red" />
      </section>

      <div className="relative min-h-0 flex-1 touch-none" onPointerDown={onTap}>
        <canvas
          aria-label="로컬 3D 탁구 코트"
          className="absolute inset-0 size-full"
          ref={canvasRef}
        />

        {mode === 'duo' && (
          <>
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white/20" />
            <span className="pointer-events-none absolute top-3 left-3 font-mono text-xs text-[#73bfff]">
              ◀ P1
            </span>
            <span className="pointer-events-none absolute top-3 right-3 font-mono text-xs text-[#ff8b7c]">
              P2 ▶
            </span>
          </>
        )}

        {hud.countdown > 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <strong className="text-[14vh] leading-none text-white/85 drop-shadow-2xl">
              {hud.countdown}
            </strong>
          </div>
        )}

        <LocalFeedbackMessage feedback={feedback} situationLabel={situationLabel} />

        {glFailed && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-[#070b12]/95 px-6 text-center">
            <div>
              <div className="text-5xl">🧩</div>
              <h2 className="mt-3 text-xl font-black">3D를 띄울 수 없어요</h2>
              <p className="text-sm text-white/55">
                WebGL을 지원하는 최신 브라우저에서 다시 열어주세요.
              </p>
            </div>
          </div>
        )}

        {hud.phase === 'over' && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-black/65 px-5 backdrop-blur-sm">
            <section className="grid w-full max-w-xs gap-4 rounded-3xl border border-white/15 bg-[#0b111b] p-6 text-center shadow-2xl">
              <div className="text-5xl">🏆</div>
              <h2 className="m-0 text-2xl font-black">
                {mode === 'solo'
                  ? hud.s1 > hud.s2
                    ? '승리!'
                    : '패배'
                  : `P${hud.s1 > hud.s2 ? 1 : 2} 승리!`}
              </h2>
              <p className="m-0 text-lg text-white/65">
                {hud.s1} : {hud.s2}
              </p>
              <Button onClick={restart} size="lg">
                다시 하기
              </Button>
              <Button onClick={onExit} size="lg" variant="secondary">
                게임 선택
              </Button>
            </section>
          </div>
        )}
      </div>

      <footer className="relative z-10 flex-none px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs text-white/40">
        {mode === 'duo'
          ? '왼쪽 탭·스페이스 = P1 · 오른쪽 탭·P = P2'
          : '화면 탭·스페이스·휴대폰 스윙으로 받아치기'}
      </footer>
    </main>
  )
}

function createResultId() {
  return globalThis.crypto.randomUUID()
}

function LocalScore({
  label,
  score,
  tone,
}: {
  label: string
  score: number
  tone: 'blue' | 'red'
}) {
  return (
    <div
      className={`grid min-w-20 text-center ${tone === 'blue' ? 'text-[#73bfff]' : 'text-[#ff8b7c]'}`}
    >
      <span className="font-mono text-xs font-bold text-white/55">{label}</span>
      <strong className="font-mono text-4xl leading-none">{score}</strong>
    </div>
  )
}

function feedbackClass(kind: LocalFeedback['kind']) {
  if (kind === 'smash') return 'text-[#ff7a4d]'
  if (kind === 'nice') return 'text-[#ffd24a]'
  if (kind === 'bad') return 'text-[#ff6b6b]'
  if (kind === 'miss') return 'text-[#c7ced7]'
  return 'text-[#49e08a]'
}
