import { DuelButton } from '@/duel/components/DuelButton'
import { AmmoRow, DrawSourceStatus, Lamp } from '@/duel/components/DuelController/ControllerParts'
import {
  type ControllerSignal,
  DrawPrompt,
  signalOf,
} from '@/duel/components/DuelController/DrawPrompt'
import { MAX_FOULS } from '@/duel/domain/duel'
import type { DuelState } from '@/realtime/wsEvents'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { ControllerScreen } from '@/shared/components/Screen'
import type { SwingPermission } from '@/shared/useSwing'

interface DuelControllerProps {
  error: string | null
  nickname: string
  onDraw: () => void
  onEnableMotion: () => void
  onLeave: () => void
  opponentName: string
  permission: SwingPermission
  playerId: string
  state: DuelState
}

/** 나와 상대의 탄약(체력)·경고·반응 시간. 결과 국면에만 시간을 보인다. */
function AmmoBoard({
  opponentName,
  playerId,
  signal,
  state,
}: {
  opponentName: string
  playerId: string
  signal: ControllerSignal
  state: DuelState
}) {
  const rival = state.playerOrder.find((id) => id !== playerId) ?? ''
  return (
    <section
      aria-label="탄약과 경고"
      className="mt-4 grid flex-none grid-cols-2 gap-2 rounded-card border border-border bg-surface-veil p-3"
    >
      <AmmoRow
        fouls={state.fouls[playerId] ?? 0}
        hp={state.hp[playerId] ?? 0}
        label="나"
        ms={state.reactions[playerId] ?? null}
        showMs={signal === 'result'}
      />
      <AmmoRow
        fouls={state.fouls[rival] ?? 0}
        hp={state.hp[rival] ?? 0}
        label={opponentName}
        ms={state.reactions[rival] ?? null}
        showMs={signal === 'result'}
      />
    </section>
  )
}

/** 뽑기 면 아래 안내 — 부정출발 경고·센서 켜기·입력 수단·전송 오류. */
function ControllerNotices({
  error,
  fouls,
  live,
  onEnableMotion,
  permission,
}: Pick<DuelControllerProps, 'error' | 'onEnableMotion' | 'permission'> & {
  fouls: number
  live: boolean
}) {
  return (
    <section className="mt-3 grid flex-none gap-2 text-center">
      {live && fouls > 0 && (
        <p className="m-0 text-sm font-bold text-duel-gold" role="status">
          부정출발 경고 {fouls}/{MAX_FOULS} ·{' '}
          {fouls >= MAX_FOULS - 1 ? '한 번 더면 자기 발을 쏜다' : '신호를 보고 뽑아라'}
        </p>
      )}
      {permission === 'unknown' && (
        <DuelButton onClick={onEnableMotion}>휴대폰 휘두르기 켜기</DuelButton>
      )}
      <DrawSourceStatus permission={permission} />
      {error && (
        <p className="m-0 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

export function DuelController({
  error,
  nickname,
  onDraw,
  onEnableMotion,
  onLeave,
  opponentName,
  permission,
  playerId,
  state,
}: DuelControllerProps) {
  const signal = signalOf(state, playerId)
  const fouls = state.fouls[playerId] ?? 0
  const myMs = state.reactions[playerId] ?? null
  const live = signal === 'hold' || signal === 'draw'

  return (
    <ControllerScreen className="bg-duel-canvas">
      <header className="flex flex-none items-center justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <span className="font-mono text-2xs tracking-[0.18em] text-duel-accent/60">
            PHONE CONTROLLER
          </span>
          <strong className="truncate text-lg">{nickname}</strong>
        </div>
        <GameChromeButton onClick={onLeave}>나가기</GameChromeButton>
      </header>

      <AmmoBoard opponentName={opponentName} playerId={playerId} signal={signal} state={state} />

      <button
        aria-label="뽑기"
        className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-hero border border-duel-accent/20 bg-[radial-gradient(circle_at_50%_40%,rgb(255_207_138_/_10%),transparent_62%)] active:bg-surface-veil"
        onPointerDown={(event) => {
          event.preventDefault()
          onDraw()
        }}
        type="button"
      >
        <Lamp signal={signal} />
        <DrawPrompt
          ms={myMs}
          opponentName={opponentName}
          permission={permission}
          signal={signal}
          state={state}
          you={playerId}
        />
      </button>

      <ControllerNotices
        error={error}
        fouls={fouls}
        live={live}
        onEnableMotion={onEnableMotion}
        permission={permission}
      />
    </ControllerScreen>
  )
}
