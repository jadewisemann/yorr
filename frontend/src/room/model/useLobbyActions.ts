import type { PlayerId, RoomSnapshot } from '@/realtime/wsEvents'
import { useAddBot, useRemoveBot, useStartGame } from '@/room/api/useGameApi'

interface UseLobbyActionsOptions {
  canStart: boolean
  capacity: number
  isHost: boolean
  snapshot: RoomSnapshot | null
}

/**
 * 대기실에서 호스트가 하는 세 가지 — 시작, 봇 추가, 봇 제거.
 *
 * 눌러도 되는지는 방 상태가 이미 알고 있으므로 인자로 받는다. 여기서 다시 계산하면
 * 버튼의 disabled와 실제 동작이 서로 다른 근거로 판단하게 된다.
 */
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
