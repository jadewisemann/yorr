import type { CompletionRoomSnapshot, Ranking } from '../../completion/index.js'

/** 전적 보관 검사가 함께 쓰는 한 판. 인메모리 절반과 실 MySQL 절반이 같은 값을 본다. */
export const GAME_ID = 'game-1'
export const FIXED_NOW = new Date('2026-08-14T02:03:04.005Z')

export const room = (
  players: readonly { playerId: string; nickname: string }[],
): CompletionRoomSnapshot => ({
  roomCode: 'ROOM01',
  gameCode: 'YACHT_DICE',
  gameId: GAME_ID,
  players: players.map((player) => ({ ...player, kind: 'HUMAN' })),
})

export const ranking = (rank: number, playerId: string, total: number): Ranking => ({
  rank,
  playerId,
  total,
})
