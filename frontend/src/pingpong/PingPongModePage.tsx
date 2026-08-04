import { useNavigate } from '@tanstack/react-router'
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Button } from '@/shared/components/Button'
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
import { createScene, type PingPongScene } from './scene3d'
import { useSwing } from './useSwing'

const DIFFICULTY_LABEL: Record<LocalPingPongDifficulty, string> = {
  easy: '쉬움',
  hard: '어려움',
  normal: '보통',
}

interface LocalSelection {
  difficulty: LocalPingPongDifficulty
  mode: LocalPingPongMode
}

export function PingPongModePage() {
  const navigate = useNavigate()
  const [local, setLocal] = useState<LocalSelection | null>(null)

  if (local) {
    return (
      <LocalPingPongGame
        difficulty={local.difficulty}
        key={`${local.mode}-${local.difficulty}`}
        mode={local.mode}
        onExit={() => setLocal(null)}
      />
    )
  }

  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden bg-[#070b12] px-5 py-[max(1.25rem,env(safe-area-inset-top))] text-white">
      <div className="absolute inset-0 [background:radial-gradient(circle_at_50%_35%,rgb(43_143_224_/_24%),transparent_48%)]" />
      <button
        className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 z-10 min-h-11 rounded-full border border-white/15 bg-black/30 px-4 text-sm text-white/75"
        onClick={() => void navigate({ to: '/' })}
        type="button"
      >
        ‹ 게임 선택
      </button>

      <section className="relative z-10 grid w-full max-w-md gap-6 rounded-[2rem] border border-white/15 bg-black/35 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        <header className="text-center">
          <div className="mb-2 text-5xl">🏓</div>
          <p className="m-0 font-mono text-xs tracking-[0.22em] text-white/45">PING · PONG</p>
          <h1 className="mt-2 mb-0 text-3xl font-black">플레이 모드</h1>
          <p className="mt-2 mb-0 text-sm leading-relaxed text-white/55">
            혼자 연습하거나, QR로 두 휴대폰을 연결하거나,
            <br />
            초대 링크로 온라인 대전을 시작하세요.
          </p>
        </header>

        <div className="grid gap-3">
          <div className="rounded-2xl border border-white/12 bg-white/6 p-3">
            <p className="mt-0 mb-2 text-center font-mono text-xs tracking-[0.12em] text-white/45">
              봇전 · 난이도 선택
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(['easy', 'normal', 'hard'] as const).map((difficulty) => (
                <button
                  className={`min-h-12 rounded-xl border text-sm font-black transition active:scale-[0.98] ${difficultyClass(difficulty)}`}
                  key={difficulty}
                  onClick={() => setLocal({ difficulty, mode: 'solo' })}
                  type="button"
                >
                  {DIFFICULTY_LABEL[difficulty]}
                </button>
              ))}
            </div>
          </div>

          <button
            className="min-h-16 rounded-2xl border border-[#ff8b7c]/45 bg-[#ff8b7c]/12 px-5 text-left transition active:scale-[0.99] active:bg-[#ff8b7c]/20"
            onClick={() => void navigate({ to: '/party', search: { game: 'pingpong' } })}
            type="button"
          >
            <strong className="block text-base text-[#ffb0a5]">1:1 파티 모드</strong>
            <span className="mt-1 block text-xs text-white/50">
              대기실 QR로 두 폰을 연결해 대전
            </span>
          </button>

          <button
            className="min-h-16 rounded-2xl border border-[#49e08a]/45 bg-[#49e08a]/12 px-5 text-left transition active:scale-[0.99] active:bg-[#49e08a]/20"
            onClick={() =>
              void navigate({ to: '/join', search: { code: undefined, game: 'pingpong' } })
            }
            type="button"
          >
            <strong className="block text-base text-[#8dffc0]">온라인 모드</strong>
            <span className="mt-1 block text-xs text-white/50">
              방을 만들고 초대 링크로 1:1 대전
            </span>
          </button>
        </div>
      </section>
    </main>
  )
}

function difficultyClass(difficulty: LocalPingPongDifficulty) {
  if (difficulty === 'easy') return 'border-[#49e08a]/40 bg-[#49e08a]/12 text-[#8dffc0]'
  if (difficulty === 'hard') return 'border-[#ff8b7c]/40 bg-[#ff8b7c]/12 text-[#ffb0a5]'
  return 'border-[#73bfff]/55 bg-[#2b8fe0] text-white shadow-lg'
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

function LocalPingPongGame({
  difficulty,
  mode,
  onExit,
}: {
  difficulty: LocalPingPongDifficulty
  mode: LocalPingPongMode
  onExit: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<LocalPingPongState>(createLocalGame(mode, difficulty))
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

  const restart = () => {
    restartLocalGame(gameRef.current)
    setFeedback(null)
    setHud(hudOf(gameRef.current))
  }

  const onTap = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode !== 'duo') {
      swing(1)
      return
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    swing(event.clientX - bounds.left < bounds.width / 2 ? 1 : 2)
  }

  const p1Label = mode === 'solo' ? 'YOU' : 'P1'
  const p2Label = mode === 'solo' ? 'CPU' : 'P2'

  return (
    <main className="relative flex h-svh w-full flex-col overflow-hidden bg-[#070b12] text-white">
      <header className="relative z-20 flex flex-none items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <button
          className="min-h-11 rounded-full border border-white/15 bg-white/6 px-4 text-sm text-white/75"
          onClick={onExit}
          type="button"
        >
          ‹ 모드 선택
        </button>
        <span className="font-mono text-xs tracking-[0.14em] text-white/45">
          {mode === 'solo' ? `봇전 · ${DIFFICULTY_LABEL[difficulty]}` : '1:1 파티 모드'}
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

        {feedback && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <strong
              className={`text-4xl font-black drop-shadow-2xl ${feedbackClass(feedback.kind)}`}
            >
              {feedback.text}
            </strong>
          </div>
        )}

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
                모드 선택
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
