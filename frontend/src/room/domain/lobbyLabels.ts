import type { GameCode } from '@/games'
import type { useAppStore } from '@/store'

export function isDuoGame(gameCode: GameCode | undefined): boolean {
  return gameCode === 'PING_PONG' || gameCode === 'DUEL'
}

export function connectionLabel(
  status: ReturnType<typeof useAppStore.getState>['connectionStatus'],
) {
  if (status === 'connected') return '연결됨'
  if (status === 'reconnecting') return '재연결 중'
  if (status === 'closed') return '연결 종료'
  return '연결 중'
}
