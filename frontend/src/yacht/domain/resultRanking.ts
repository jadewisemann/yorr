import type { RoomSnapshot } from '@/realtime/wsEvents'
import type { RankedPlayer } from '@/yacht/components/ResultRanking'

/** ⑦ 최종 결과. 결과 확인 3초 → 재대결 1탭이 목표다. */
/**
 * 순위는 서버가 game.over로 보낸 값을 그대로 쓴다(총점도 서버 확정값). 로컬 재계산은
 * score.update를 하나라도 놓치면 서버와 다른 등수를 보여주므로 폴백으로만 남긴다.
 */
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
      // 동점이면 내 자리를 위로 올려 스스로 찾기 쉽게 한다.
      if (left.playerId === you) return -1
      if (right.playerId === you) return 1
      return 0
    })
}
