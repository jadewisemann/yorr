import type { GameCode } from '@/games'
import type { useAppStore } from '@/store'

/**
 * 1:1 게임(탁구·결투)인가. 이 게임들은 봇을 받지 않고, 둘이 모여야 시작하며, 야추의 주사위
 * 월드도 쓰지 않는다 — 대기실이 세 곳에서 같은 판단을 하므로 이름을 붙여 둔다.
 */
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
