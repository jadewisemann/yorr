// 키 스킴은 계약이다(운영 중 Redis에 이미
// 이 이름으로 데이터가 있다) — docs/design/rooms-and-sessions.md 「Redis 키 스킴」.
export const ROOM_KEY_PREFIX = 'room:'

export const roomKey = (roomCode: string): string => `${ROOM_KEY_PREFIX}${roomCode}`

export const playersKey = (roomCode: string): string => `${roomKey(roomCode)}:players`

export const scoresKey = (roomCode: string): string => `${roomKey(roomCode)}:scores`

export const botsKey = (roomCode: string): string => `${roomKey(roomCode)}:bots`

export const gameKey = (gameId: string): string => `game:${gameId}`

export const gameScoreboardKey = (gameId: string, playerId: string): string =>
  `${gameKey(gameId)}:scoreboard:${playerId}`

export const gameScoreSubmissionsKey = (gameId: string, playerId: string): string =>
  `${gameKey(gameId)}:score-submissions:${playerId}`

export const gameStateKey = (roomCode: string, gameCode: string): string =>
  `${roomKey(roomCode)}:game:${gameCode}:state`

/** 방 키 가족 — 항상 같은 순간에 만료돼야 한다(반쪽 방 금지). Lua 호출의 KEYS 순서다. */
export const roomKeyFamily = (roomCode: string): [string, string, string, string] => [
  roomKey(roomCode),
  playersKey(roomCode),
  scoresKey(roomCode),
  botsKey(roomCode),
]
