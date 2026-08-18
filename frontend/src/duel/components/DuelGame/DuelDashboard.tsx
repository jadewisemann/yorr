import type { RefObject } from 'react'
import { Arena } from '@/duel/components/Arena'
import { MAX_FOULS, MAX_HP } from '@/duel/domain/duel'
import { buildStage } from '@/duel/domain/stage'
import type { DuelState, RoomSnapshot } from '@/realtime/wsEvents'
import { GameChromeButton } from '@/shared/components/GameChromeButton'
import { GameCanvas } from '@/shared/components/Screen'

export function DuelDashboard({
  flight,
  impact,
  impactDelayMs,
  onClose,
  snapshot,
  stageRef,
  state,
}: {
  flight: number
  impact: boolean
  impactDelayMs: number
  onClose: () => void
  snapshot: RoomSnapshot
  stageRef: RefObject<HTMLElement | null>
  state: DuelState
}) {
  const [first, second] = state.playerOrder
  const nameOf = (playerId: string | undefined) =>
    snapshot.players.find((player) => player.playerId === playerId)?.nickname ?? '?'

  return (
    <GameCanvas className="flex flex-col bg-duel-canvas select-none" ref={stageRef}>
      <Arena
        {...buildStage({
          impact,
          opponentId: second ?? '',
          opponentName: nameOf(second),
          state,
          you: first ?? '',
          youName: nameOf(first),
          youShot: null,
        })}
        actLabel="DRAW!"
        flightMs={flight}
        fxKey={state.round}
        hint="폰에서 뽑습니다"
        impactDelayMs={impactDelayMs}
        maxFouls={MAX_FOULS}
        maxHp={MAX_HP}
        round={state.round}
      />

      <GameChromeButton
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-20"
        tone="overlay"
        onClick={onClose}
        type="button"
      >
        방 닫기
      </GameChromeButton>
    </GameCanvas>
  )
}
