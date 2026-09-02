import { randomUUID } from 'node:crypto'
import type { Pool, RowDataPacket } from 'mysql2/promise'
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

/**
 * 회원 한 사람과 게스트 한 사람이 섞인 한 판. 판 자체는 온전히 남고 주인이 있는
 * 행에만 계정이 붙는다는 계약을, 인메모리 절반과 실 MySQL 절반이 같은 값으로 본다.
 */
export const mixedMatch = (memberId: string) => ({
  snapshot: room([
    { playerId: memberId, nickname: '방에서쓴이름' },
    { playerId: 'guest-1', nickname: '지나가던손님' },
  ]),
  rankings: [ranking(1, memberId, 210), ranking(2, 'guest-1', 180)],
})

/** 게스트 혼자 끝낸 판. 같은 게임이 두 번 쌓이지 않는지 보는 검사들이 쓴다. */
export const soloGuestMatch = () => ({
  snapshot: room([{ playerId: 'guest-1', nickname: '손님' }]),
  rankings: [ranking(1, 'guest-1', 100)],
})

/**
 * 방 없이 진행된 로컬 게임(탁구 AI) 한 판. 회원 한 사람과 AI 자리가 같은 규칙으로
 * 남는지 본다 — AI는 계정이 없으므로 이름만 남는다.
 */
export const localAiMatch = (gameId: string, memberId: string) => ({
  gameId,
  gameCode: 'PING_PONG',
  roomCode: 'LOCAL_AI',
  participants: [
    { playerId: memberId, totalScore: 11, ranking: 1 },
    { playerId: 'ping-pong-ai', displayNickname: 'AI', totalScore: 7, ranking: 2 },
  ],
})

/** `match_participants` 한 줄. 보관된 판이 무엇을 남겼는지 실 MySQL에서 읽어 본다. */
export interface ParticipantRow extends RowDataPacket {
  readonly user_id: string | null
  readonly player_id: string
  readonly display_nickname: string
  readonly total_score: number
  readonly ranking: number
}

/** 회원 한 사람을 `users`에 넣고 그 id를 돌려준다. 가입 시각은 고정한다. */
export const signUpMember = async (pool: Pool, nickname: string): Promise<string> => {
  const id = randomUUID()
  const at = new Date('2026-08-01T00:00:00.000Z')
  await pool.query(
    'INSERT INTO users (id, nickname, profile_image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, nickname, null, at, at],
  )
  return id
}

/** 그 판의 참가자들을 순위대로. 동순위는 playerId로 갈라 순서가 흔들리지 않게 한다. */
export const participantsOf = async (pool: Pool, gameId: string): Promise<ParticipantRow[]> => {
  const [rows] = await pool.query<ParticipantRow[]>(
    `SELECT p.user_id, p.player_id, p.display_nickname, p.total_score, p.ranking
       FROM match_participants p JOIN matches m ON m.id = p.match_id
      WHERE m.game_id = ? ORDER BY p.ranking, p.player_id`,
    [gameId],
  )
  return rows
}
