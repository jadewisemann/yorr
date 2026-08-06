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
  /** 화면을 눌러 뽑기. 스윙은 부모(DuelGame)의 useSwing이 같은 곳으로 보낸다. */
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
  // 뽑기는 신호 전에도 받는다 — 성급하게 당기는 것도 플레이의 일부이고, 부정출발 판정은
  // 서버 몫이다. 눌러도 아무 일 없는 버튼으로 막으면 "안 눌린 것"과 구별되지 않는다.
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

      {/* 기록(ms)은 판정이 난 뒤에만, 그리고 <b>여기에만</b> 뜬다. 유예 중에 상대 기록이
          보이면 승부가 김이 새고, 같은 숫자를 가운데 문구와 여기 둘 다 쓰면 좁은 화면에서
          같은 것을 두 번 읽는다. */}
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
        {/* 경고는 신호를 기다리는 동안에만 세운다 — 판정 문구와 겹쳐 읽히면 둘 다 안 읽힌다. */}
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
