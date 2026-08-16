import { useNavigate } from '@tanstack/react-router'
import type {
  LocalFeedback,
  LocalPingPongDifficulty,
  LocalPingPongMode,
} from '@/pingpong/domain/localGame'
import { pingPongSituation, sharedSituationLabel } from '@/pingpong/feedback'
import { type HudState, useLocalPingPongGame } from '@/pingpong/model/useLocalPingPongGame'
import { Button } from '@/shared/components/Button'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { IconBack, IconWarning } from '@/shared/components/Icon'
import { GameCanvas } from '@/shared/components/Screen'

export function PingPongModePage() {
  const navigate = useNavigate()
  return (
    <LocalPingPongGame difficulty="normal" mode="solo" onExit={() => void navigate({ to: '/' })} />
  )
}

function localSituationLabel(hud: HudState, firstLabel: string, secondLabel: string) {
  if (hud.phase !== 'point') return null
  return sharedSituationLabel(pingPongSituation(hud.s1, hud.s2), firstLabel, secondLabel)
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
        className={`text-4xl font-black drop-shadow-2xl ${feedback ? feedbackClass(feedback.kind) : 'text-pp-gold'}`}
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
  const { canvasRef, feedback, glFailed, hud, onTap, permission, requestPermission, restart } =
    useLocalPingPongGame({ difficulty, mode })

  const p1Label = mode === 'solo' ? 'YOU' : 'P1'
  const p2Label = mode === 'solo' ? 'CPU' : 'P2'
  const situationLabel = localSituationLabel(hud, p1Label, p2Label)

  return (
    <GameCanvas className="flex flex-col bg-pp-canvas text-white">
      <header className="relative z-20 flex flex-none items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <GameChromeButton className="gap-1.5" onClick={onExit}>
          <IconBack className="size-4" />
          게임 선택
        </GameChromeButton>
        <span className="font-mono text-xs tracking-[0.14em] text-game-content-faint">
          {mode === 'solo' ? 'AI와 대전' : '1:1 파티 모드'}
        </span>
        {permission === 'unknown' ? (
          <button
            className="min-h-11 rounded-full border border-pp-accent/40 bg-pp-accent/12 px-3 text-xs font-bold text-pp-accent-text transition-[scale] duration-150 focus-ring active:not-disabled:scale-[0.97]"
            onClick={() => void requestPermission()}
            type="button"
          >
            폰 스윙
          </button>
        ) : (
          <span className="min-w-20 text-right text-xs text-pp-accent">스윙 ON</span>
        )}
      </header>

      <section className="relative z-10 flex flex-none items-end justify-center gap-6 pb-2">
        <LocalScore label={p1Label} score={hud.s1} tone="blue" />
        <span className="pb-1 text-2xl text-game-separator">:</span>
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
            <span className="pointer-events-none absolute top-3 left-3 font-mono text-xs text-pp-side-blue-text">
              ◀ P1
            </span>
            <span className="pointer-events-none absolute top-3 right-3 font-mono text-xs text-pp-danger-text">
              P2 ▶
            </span>
          </>
        )}

        {hud.countdown > 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <strong className="text-[14vh] leading-none text-game-content drop-shadow-2xl">
              {hud.countdown}
            </strong>
          </div>
        )}

        <LocalFeedbackMessage feedback={feedback} situationLabel={situationLabel} />

        {glFailed && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-pp-canvas/95 px-6 text-center">
            <div>
              <IconWarning className="mx-auto size-10 text-pp-gold" />
              <h2 className="mt-3 text-xl font-black">3D를 띄울 수 없어요</h2>
              <p className="text-sm text-game-content-muted">
                WebGL을 지원하는 최신 브라우저에서 다시 열어주세요.
              </p>
            </div>
          </div>
        )}

        {hud.phase === 'over' && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-black/65 px-5 backdrop-blur-sm">
            <section className="grid w-full max-w-xs gap-4 rounded-sheet border border-white/15 bg-pp-surface p-6 text-center shadow-2xl">
              <h2 className="m-0 text-2xl font-black">
                {mode === 'solo'
                  ? hud.s1 > hud.s2
                    ? '승리!'
                    : '좋은 경기였어요'
                  : `P${hud.s1 > hud.s2 ? 1 : 2} 승리!`}
              </h2>
              <p className="m-0 text-lg text-game-content-muted">
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

      <footer className="relative z-10 flex-none px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs text-game-content-faint">
        {mode === 'duo'
          ? '왼쪽 탭·스페이스 = P1 · 오른쪽 탭·P = P2'
          : '화면 탭·스페이스·휴대폰 스윙으로 받아치기'}
      </footer>
    </GameCanvas>
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
      className={`grid min-w-20 text-center ${tone === 'blue' ? 'text-pp-side-blue-text' : 'text-pp-danger-text'}`}
    >
      <span className="font-mono text-xs font-bold text-game-content-muted">{label}</span>
      <strong className="font-mono text-4xl leading-none">{score}</strong>
    </div>
  )
}

function feedbackClass(kind: LocalFeedback['kind']) {
  if (kind === 'smash') return 'text-pp-smash'
  if (kind === 'nice') return 'text-pp-gold'
  if (kind === 'bad') return 'text-pp-danger-text'
  if (kind === 'miss') return 'text-pp-muted'
  return 'text-pp-accent'
}
