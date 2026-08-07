import { AmmoRow, DrawSourceStatus, Lamp } from '@/duel/components/DuelController/ControllerParts'
import { DrawPrompt, signalOf } from '@/duel/components/DuelController/DrawPrompt'
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
  const rival = state.playerOrder.find((id) => id !== playerId) ?? ''
  const live = signal === 'hold' || signal === 'draw'

  return (
    <ControllerScreen className="bg-duel-canvas">
      <header className="flex flex-none items-center justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="font-mono text-2xs tracking-[0.18em] text-duel-accent/60">
            PHONE CONTROLLER
          </span>
          <strong className="truncate text-lg">{nickname}</strong>
        </div>
        <GameChromeButton onClick={onLeave}>나가기</GameChromeButton>
      </header>

      <section
        aria-label="탄약과 경고"
        className="mt-4 grid flex-none grid-cols-2 gap-2 rounded-card border border-white/12 bg-white/6 p-3"
      >
        <AmmoRow
          fouls={fouls}
          hp={state.hp[playerId] ?? 0}
          label="나"
          ms={myMs}
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

      <button
        aria-label="뽑기"
        className="relative mt-4 min-h-0 flex-1 overflow-hidden rounded-hero border border-duel-accent/20 bg-[radial-gradient(circle_at_50%_40%,rgb(255_207_138_/_10%),transparent_62%)] active:bg-white/8"
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

      <section className="mt-3 grid flex-none gap-2 text-center">
        {live && fouls > 0 && (
          <p className="m-0 text-sm font-bold text-duel-gold" role="status">
            부정출발 경고 {fouls}/{MAX_FOULS} ·{' '}
            {fouls >= MAX_FOULS - 1 ? '한 번 더면 자기 발을 쏜다' : '신호를 보고 뽑아라'}
          </p>
        )}
        {permission === 'unknown' && (
          <button
            className="min-h-12 rounded-card border border-duel-signal/50 bg-duel-signal/15 px-5 font-bold text-duel-accent-soft transition-[scale] duration-150 focus-ring active:not-disabled:scale-[0.97]"
            onClick={onEnableMotion}
            type="button"
          >
            휴대폰 휘두르기 켜기
          </button>
        )}
        <DrawSourceStatus permission={permission} />
        {error && (
          <p className="m-0 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
      </section>
    </ControllerScreen>
  )
}
