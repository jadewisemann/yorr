import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createYachtGame,
  restoreYachtGame,
  type YachtGameAction,
  yachtGameReducer,
} from '@/domain/yachtGame'
import type { GameState, PlayerId } from '@/realtime/wsEvents'

type RollRequestedAction = Extract<YachtGameAction, { type: 'rollRequested' }>

interface UseGamePlayRollOptions {
  activePlayerId: PlayerId | undefined
  game: GameState | undefined
  roundNumber: number
}

export function useGamePlayRoll({ activePlayerId, game, roundNumber }: UseGamePlayRollOptions) {
  const [local, setLocal] = useState(() =>
    restoreYachtGame(Date.now() >>> 0, roundNumber, {
      rollCount: game?.rollCount ?? 0,
      dice: game?.dice ?? null,
      held: game?.held ?? null,
    }),
  )
  const acceptedRollTurnRef = useRef<{ playerId: PlayerId; roundNumber: number } | null>(null)
  const activePlayerRef = useRef(activePlayerId)

  if (local.roundNumber !== roundNumber) setLocal(createYachtGame(local.seed, roundNumber))

  useEffect(() => {
    if (activePlayerRef.current === activePlayerId) return
    activePlayerRef.current = activePlayerId
    const acceptedRollTurn = acceptedRollTurnRef.current
    acceptedRollTurnRef.current = null
    if (
      acceptedRollTurn?.playerId !== activePlayerId ||
      acceptedRollTurn?.roundNumber !== roundNumber
    ) {
      setLocal((state) => createYachtGame(state.seed, roundNumber))
    }
  }, [activePlayerId, roundNumber])

  const dispatch = useCallback((action: YachtGameAction) => {
    setLocal((state) => yachtGameReducer(state, action))
  }, [])

  const applyServerRoll = useCallback(
    (playerId: PlayerId, serverRoundNumber: number, action: RollRequestedAction) => {
      acceptedRollTurnRef.current = { playerId, roundNumber: serverRoundNumber }
      setLocal((state) =>
        yachtGameReducer(
          state.roundNumber === serverRoundNumber
            ? state
            : createYachtGame(state.seed, serverRoundNumber),
          action,
        ),
      )
    },
    [],
  )

  return { applyServerRoll, dispatch, local }
}
