import { PingPongButton } from '@/pingpong/components/PingPongButton'
import type { ControllerView, PaddleTone } from '@/pingpong/components/PingPongController/types'
import type { PingPongState } from '@/realtime/wsEvents'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { ControllerScreen } from '@/shared/components/Screen'
import type { SwingPermission } from '@/shared/useSwing'
import { paddleFaceClass } from './ControllerArena'
import { playerSlots } from './ControllerScore'

export function usesTouchFallback(permission: SwingPermission) {
  return permission === 'denied' || permission === 'unsupported'
}

export function selectPracticeAction(
  permission: SwingPermission,
  requestPermission: () => Promise<void>,
  onTouchSwing: () => void,
): (() => void) | undefined {
  if (permission === 'unknown') return () => void requestPermission()
  return usesTouchFallback(permission) ? onTouchSwing : undefined
}

export function practicePrompt(permission: SwingPermission) {
  if (permission === 'unknown') return '화면을 눌러 모션 센서 연결'
  if (permission === 'granted') return '센서 연결 완료 · 휴대폰을 휘둘러 스윙'
  return '화면을 눌러 스윙 · 센서 대체 조작'
}

export function readyButtonLabel(practiced: boolean, ready: boolean) {
  if (ready) return '준비 완료 · 친구를 기다리는 중'
  return practiced ? '준비 완료' : '먼저 공을 한 번 쳐보세요'
}

export function PreparationMotionStatus({
  permission,
  practiced,
}: {
  permission: SwingPermission
  practiced: boolean
}) {
  if (practiced || permission === 'unknown') return null
  if (permission === 'granted') {
    return (
      <p className="m-0 text-center text-sm font-bold text-pp-accent-text" role="status">
        센서 연결 완료 · 휴대폰을 실제로 휘둘러 주세요
      </p>
    )
  }
  return (
    <p className="m-0 text-center text-sm text-amber-200" role="status">
      모션 센서를 사용할 수 없어 화면 터치 대체 조작을 사용합니다.
    </p>
  )
}

export function PreparationStatus({
  label,
  ready,
  tag,
}: {
  label: string
  ready: boolean
  tag: string
}) {
  return (
    <div
      className={`rounded-card border px-3 py-2.5 text-center text-sm font-bold ${ready ? 'border-pp-accent/45 bg-pp-accent/12 text-pp-accent-text' : 'border-border bg-surface-veil text-game-content-faint'}`}
    >
      <span className="flex items-center justify-center gap-1">
        <span className="rounded-xs border border-current px-1 font-mono text-2xs font-black leading-none">
          {tag}
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-0.5 block text-xs">{ready ? '준비 완료' : '연습 중'}</span>
    </div>
  )
}

function PreparationHeader({ nickname, onLeave }: { nickname: string; onLeave: () => void }) {
  return (
    <header className="flex flex-none items-center justify-between gap-3">
      <div className="grid min-w-0 gap-1">
        <span className="font-mono text-2xs tracking-[0.18em] text-pp-side-blue-text">WARM-UP</span>
        <strong className="truncate text-lg">{nickname}</strong>
      </div>
      <GameChromeButton onClick={onLeave}>나가기</GameChromeButton>
    </header>
  )
}

/** 연습 공을 치는 큰 면. 스윙이 감지되면 공이 튀고 라켓이 돈다. */
function PracticePad({
  paddleTone,
  permission,
  practiceAck,
  practiced,
  practiceAction,
}: {
  paddleTone: PaddleTone
  permission: SwingPermission
  practiceAck: boolean
  practiced: boolean
  practiceAction: (() => void) | undefined
}) {
  const paddleFace = paddleFaceClass(paddleTone)
  return (
    <button
      aria-label="연습 공 치기"
      aria-disabled={permission === 'granted'}
      className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-hero border border-pp-side-blue/35 bg-[radial-gradient(circle_at_50%_42%,rgb(43_143_224_/_24%),transparent_60%)] active:bg-surface-veil"
      onClick={practiceAction}
      type="button"
    >
      {/* 순백 고정 — 이건 표면이 아니라 탁구공 그 자체다. veil 사다리로 내리지 않는다. */}
      <span
        aria-hidden="true"
        className={`absolute top-[18%] left-1/2 size-14 -translate-x-1/2 rounded-full bg-white shadow-[0_0_28px_rgb(255_255_255_/_55%)] ${practiceAck ? 'animate-pp-practice-ball' : ''}`}
      />
      <span
        aria-hidden="true"
        className={`absolute top-[46%] left-1/2 block h-[34%] aspect-square -translate-x-1/2 rounded-full border-[9px] transition-transform duration-150 ${paddleFace} ${practiceAck ? 'rotate-[-28deg] scale-110' : 'rotate-[-8deg]'}`}
        data-player-tone={paddleTone}
        data-testid="ping-pong-paddle-face"
      />
      <span
        className={`absolute inset-x-4 bottom-5 text-center text-base font-black ${practiced ? 'text-pp-accent' : 'text-game-content'}`}
      >
        {practiceAck ? '스윙 감지 완료! 공을 맞혔어요' : practicePrompt(permission)}
      </span>
    </button>
  )
}

/** 센서 켜기·준비 완료·전송 오류. 연습 면 아래 한 묶음이다. */
function PreparationActions({
  error,
  onReady,
  permission,
  practiced,
  ready,
  requestPermission,
}: {
  error: string | null
  onReady: () => void
  permission: SwingPermission
  practiced: boolean
  ready: boolean
  requestPermission: () => Promise<void>
}) {
  return (
    <section className="mt-3 grid flex-none gap-2">
      {permission === 'unknown' && (
        <PingPongButton onClick={() => void requestPermission()}>폰 스윙 켜기</PingPongButton>
      )}
      <PreparationMotionStatus permission={permission} practiced={practiced} />
      <PingPongButton disabled={!practiced || ready} onClick={onReady} tone="danger" variant="cta">
        {readyButtonLabel(practiced, ready)}
      </PingPongButton>
      {error && (
        <p className="m-0 text-center text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

export function PingPongPreparationController({
  error,
  nickname,
  onLeave,
  onReady,
  onTouchSwing,
  paddleTone,
  permission,
  playerId,
  readyPlayerIds,
  requestPermission,
  state,
  view,
}: {
  error: string | null
  nickname: string
  onLeave: () => void
  onReady: () => void
  onTouchSwing: () => void
  paddleTone: PaddleTone
  permission: SwingPermission
  playerId: string
  readyPlayerIds: string[]
  requestPermission: () => Promise<void>
  state: PingPongState
  view: ControllerView
}) {
  const practiced = (state.lastInputSeq[playerId] ?? -1) >= 0
  const ready = readyPlayerIds.includes(playerId)
  const practiceAck =
    view.event?.type === 'PRACTICE' && view.event.playerId === playerId && view.eventAge < 1_200
  const practiceAction = selectPracticeAction(permission, requestPermission, onTouchSwing)
  const [p1, p2] = playerSlots(state, playerId, view.opponentName)

  return (
    <ControllerScreen className="bg-pp-canvas">
      <PreparationHeader nickname={nickname} onLeave={onLeave} />

      <section className="mt-4 grid flex-none grid-cols-2 gap-2" aria-label="참가자 준비 상태">
        <PreparationStatus label={p1.label} ready={readyPlayerIds.includes(p1.id)} tag={p1.tag} />
        <PreparationStatus label={p2.label} ready={readyPlayerIds.includes(p2.id)} tag={p2.tag} />
      </section>

      <div className="mt-5 text-center">
        <h1 className="m-0 text-2xl font-black">연습 공을 쳐보세요</h1>
        <p className="mt-1.5 mb-0 text-sm text-game-content-muted">
          {usesTouchFallback(permission)
            ? '화면을 눌러 받아치세요. '
            : '폰을 라켓처럼 세워 쥐고 팔로 짧게 휘두르세요. '}
          스윙이 감지된 뒤 준비 완료를 누르면 두 사람이 함께 시작해요.
        </p>
      </div>

      <PracticePad
        paddleTone={paddleTone}
        permission={permission}
        practiceAck={practiceAck}
        practiced={practiced}
        practiceAction={practiceAction}
      />

      <PreparationActions
        error={error}
        onReady={onReady}
        permission={permission}
        practiced={practiced}
        ready={ready}
        requestPermission={requestPermission}
      />
    </ControllerScreen>
  )
}
