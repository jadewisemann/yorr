import type { Player, PlayerId, ScoreBoard } from '@/realtime/wsEvents'

export function toTurnStripPlayers(
  players: Player[],
  turnOrder: PlayerId[] | undefined,
  scores: Record<PlayerId, ScoreBoard> | undefined,
) {
  const byId = new Map(players.map((player) => [player.playerId, player]))
  const ordered = (turnOrder ?? [])
    .map((playerId) => byId.get(playerId))
    .filter((player): player is Player => player !== undefined)
  const orderedIds = new Set(ordered.map((player) => player.playerId))
  const rest = players.filter((player) => !orderedIds.has(player.playerId))
  return [...ordered, ...rest].map((player) => ({
    nickname: player.nickname,
    playerId: player.playerId,
    status: player.status,
    total: scores?.[player.playerId]?.total ?? 0,
  }))
}

export function toMatrixPlayers(
  players: Player[],
  scores: Record<PlayerId, ScoreBoard> | undefined,
  you: PlayerId,
) {
  const ordered = [...players].sort((left, right) => {
    if (left.playerId === you) return -1
    if (right.playerId === you) return 1
    return 0
  })
  return ordered.map((player) => ({
    nickname: player.playerId === you ? '나' : player.nickname,
    playerId: player.playerId,
    scoreboard: scores?.[player.playerId],
  }))
}
