import { useEffect, useState } from 'react'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import type { RoomSnapshot, ServerMessage } from '@/realtime/wsEvents'

export function useLocalRoomSnapshot(client: RealtimeClient, initial: RoomSnapshot) {
  const [snapshot, setSnapshot] = useState(initial)

  useEffect(
    () => client.onMessage((message) => setSnapshot((current) => apply(current, message))),
    [client],
  )

  return snapshot
}

function apply(snapshot: RoomSnapshot, message: ServerMessage): RoomSnapshot {
  const game = snapshot.game
  if (!game) return snapshot

  switch (message.type) {
    case 'game.yacht_dice.score.update':
      return {
        ...snapshot,
        game: {
          ...game,
          scores: { ...game.scores, [message.payload.playerId]: message.payload.scoreboard },
        },
      }
    case 'game.yacht_dice.round.start':
      return {
        ...snapshot,
        game: {
          ...game,
          activePlayerId: message.payload.activePlayerId,
          roundDeadline: message.payload.deadline,
          roundNumber: message.payload.roundNumber,
          turnOrder: message.payload.turnOrder,
          rollCount: 0,
        },
      }
    case 'game.yacht_dice.game.over':
      return {
        ...snapshot,
        phase: 'finished',
        game: { ...game, rankings: message.payload.rankings },
      }
    default:
      return snapshot
  }
}
