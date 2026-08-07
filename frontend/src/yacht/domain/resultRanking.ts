import type { RoomSnapshot } from '@/realtime/wsEvents'
import type { RankedPlayer } from '@/yacht/components/ResultRanking'

export function toRanking(snapshot: RoomSnapshot, you: string): RankedPlayer[] {
  const serverRankings = snapshot.game?.rankings
  if (serverRankings && serverRankings.length > 0) {
    const nicknameById = new Map(
      snapshot.players.map((player) => [player.playerId, player.nickname]),
    )
    return serverRankings.map((ranking) => ({
      nickname: nicknameById.get(ranking.playerId) ?? '알 수 없는 참가자',
      playerId: ranking.playerId,
      total: ranking.total,
    }))
  }

  return snapshot.players
    .map((player) => ({
      nickname: player.nickname,
      playerId: player.playerId,
      total: snapshot.game?.scores[player.playerId]?.total ?? 0,
    }))
    .sort((left, right) => {
      if (right.total !== left.total) return right.total - left.total
      if (left.playerId === you) return -1
      if (right.playerId === you) return 1
      return 0
    })
}
