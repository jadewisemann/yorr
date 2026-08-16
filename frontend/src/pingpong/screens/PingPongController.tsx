import { ControllerArena } from '@/pingpong/components/PingPongController/ControllerArena'
import {
  ControllerScore,
  playerSlots,
} from '@/pingpong/components/PingPongController/ControllerScore'
import {
  PingPongPreparationController,
  usesTouchFallback,
} from '@/pingpong/components/PingPongController/PreparationController'
import type { ControllerView, PaddleTone } from '@/pingpong/components/PingPongController/types'
import { pingPongSituation, playerEventLabel, playerSituationLabel } from '@/pingpong/feedback'
import type { PingPongState, RoomSnapshot } from '@/realtime/wsEvents'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { ControllerScreen } from '@/shared/components/Screen'
import type { SwingPermission } from '@/shared/useSwing'

interface PingPongControllerProps {
  clock: number
  error: string | null
  nickname: string
  onLeave: () => void
  onReady: () => void
  onTouchSwing: () => void
  permission: SwingPermission
  playerId: string
  requestPermission: () => Promise<void>
  snapshot: RoomSnapshot
  state: PingPongState
}

function controllerView(
  state: PingPongState,
  snapshot: RoomSnapshot,
  playerId: string,
  clock: number,
): ControllerView {
  const me = state.playerOrder.indexOf(playerId)
  const opponentId = state.playerOrder[me === 0 ? 1 : 0] ?? ''
  const opponent = snapshot.players.find((player) => player.playerId === opponentId)
  const event = state.lastEvent
  const eventAge = event ? clock - event.at : Number.POSITIVE_INFINITY
  const ownEvent = event?.playerId === playerId
  const playerIndex = me === 1 ? 1 : 0
  const situation =
    state.phase === 'COUNTDOWN'
      ? pingPongSituation(
          state.scores[state.playerOrder[0] ?? ''] ?? 0,
          state.scores[state.playerOrder[1] ?? ''] ?? 0,
        )
      : null
  return {
    countdown:
      state.phase === 'COUNTDOWN'
        ? Math.max(1, Math.ceil((state.nextActionAt - clock) / 1_000))
        : 0,
    event,
    eventAge,
    incoming: me === 0 ? state.ball.direction > 0 : state.ball.direction < 0,
    label: event ? playerEventLabel(event.type, ownEvent) : null,
    opponentId,
    opponentName: opponent?.nickname ?? '상대',
    situationLabel: playerSituationLabel(situation, playerIndex),
    swingActive: Boolean(ownEvent && eventAge < 260),
  }
}

export function PingPongController({
  clock,
  error,
  nickname,
  onLeave,
  onReady,
  onTouchSwing,
  permission,
  playerId,
  requestPermission,
  snapshot,
  state,
}: PingPongControllerProps) {
  const view = controllerView(state, snapshot, playerId, clock)
  const paddleTone: PaddleTone = state.playerOrder.indexOf(playerId) === 1 ? 'red' : 'blue'
  const [p1, p2] = playerSlots(state, playerId, view.opponentName)

  if (state.phase === 'PREPARING') {
    return (
      <PingPongPreparationController
        error={error}
        nickname={nickname}
        onLeave={onLeave}
        onReady={onReady}
        onTouchSwing={onTouchSwing}
        permission={permission}
        paddleTone={paddleTone}
        playerId={playerId}
        readyPlayerIds={state.readyPlayerIds}
        requestPermission={requestPermission}
        state={state}
        view={view}
      />
    )
  }

  return (
    <ControllerScreen className="bg-pp-canvas">
      <header className="flex flex-none items-center justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <span className="font-mono text-2xs tracking-[0.18em] text-game-content-faint">
            PHONE CONTROLLER
          </span>
          <strong className="truncate text-lg">{nickname}</strong>
        </div>
        <GameChromeButton onClick={onLeave}>나가기</GameChromeButton>
      </header>

      <section className="mt-4 flex flex-none items-center justify-between rounded-card border border-white/12 bg-white/6 px-4 py-3">
        <ControllerScore
          label={p1.label}
          score={state.scores[p1.id] ?? 0}
          tag={p1.tag}
          tone={p1.tone}
        />
        <div className="text-center">
          <span className="block font-mono text-2xs tracking-[0.14em] text-game-content-faint">
            RALLY
          </span>
          <strong className="font-mono text-2xl">{state.rally}</strong>
        </div>
        <ControllerScore
          label={p2.label}
          score={state.scores[p2.id] ?? 0}
          tag={p2.tag}
          tone={p2.tone}
        />
      </section>

      <ControllerArena
        onTouchSwing={usesTouchFallback(permission) ? onTouchSwing : undefined}
        paddleTone={paddleTone}
        rally={state.rally}
        view={view}
      />

      <section className="mt-3 grid flex-none gap-2 text-center">
        {permission === 'unknown' && (
          <button
            className="min-h-12 rounded-card border border-pp-accent/45 bg-pp-accent/12 px-5 font-bold text-pp-accent-text transition-[scale] duration-150 focus-ring active:not-disabled:scale-[0.97]"
            onClick={() => void requestPermission()}
            type="button"
          >
            폰 스윙 켜기
          </button>
        )}
        {permission === 'granted' && (
          <p className="m-0 text-sm font-bold text-pp-accent-text" role="status">
            모션 스윙 연결됨 · 휴대폰을 휘둘러 주세요
          </p>
        )}
        {usesTouchFallback(permission) && (
          <button
            className="min-h-12 rounded-card border border-white/18 bg-white/8 px-5 font-bold active:scale-[0.98] active:bg-white/15"
            onClick={onTouchSwing}
            type="button"
          >
            화면을 눌러 스윙 · 대체 조작
          </button>
        )}
        {error && (
          <p className="m-0 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
      </section>
    </ControllerScreen>
  )
}
