import type { PlayerId, RoomSnapshot } from '@/realtime/wsEvents'
import { useAddBot, useRemoveBot, useStartGame } from '@/room/api/useGameApi'

interface UseLobbyActionsOptions {
  canStart: boolean
  capacity: number
  isHost: boolean
  snapshot: RoomSnapshot | null
}

export function useLobbyActions({ canStart, capacity, isHost, snapshot }: UseLobbyActionsOptions) {
  const startGame = useStartGame()
  const addBot = useAddBot()
  const removeBot = useRemoveBot()

  return {
    addBot: async () => {
      if (!isHost || !snapshot || snapshot.players.length >= capacity) return
      await addBot.execute()
    },
    addingBot: addBot.isLoading,
    botError: addBot.error ?? removeBot.error,
    botLoading: addBot.isLoading || removeBot.isLoading,
    removeBot: (playerId: PlayerId) => void removeBot.execute(playerId),
    start: async () => {
      if (!canStart) return
      await startGame.execute()
    },
    startError: startGame.error,
    startLoading: startGame.isLoading,
  }
}
