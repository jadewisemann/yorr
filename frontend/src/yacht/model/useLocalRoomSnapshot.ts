import { useEffect, useState } from 'react'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import type { RoomSnapshot, ServerMessage } from '@/realtime/wsEvents'

/**
 * 로컬 모드의 스냅샷 보관소. 실전에서는 app/RealtimeSync가 서버 메시지를 전역 스토어에
 * 반영하지만, 로컬 모드에는 방도 세션도 없어 그 경로를 탈 수 없다(RealtimeSync는 roomSession이
 * 있어야 돌고 room.join을 보낸다). 그래서 화면 수명만큼 사는 작은 사본을 둔다.
 *
 * 다루는 메시지는 판이 진행되는 데 필요한 셋뿐이다 — 점수·다음 라운드·게임 종료. 굴림 진행은
 * GamePlay가 dice.broadcast로 직접 받으므로 여기서 세지 않는다.
 */
export function useLocalRoomSnapshot(client: RealtimeClient, initial: RoomSnapshot) {
  const [snapshot, setSnapshot] = useState(initial)

  useEffect(
    () => client.onMessage((message) => setSnapshot((current) => apply(current, message))),
    [client],
  )

  return snapshot
}

function apply(snapshot: RoomSnapshot, message: ServerMessage): RoomSnapshot {
  const game = snapshot.game
  if (!game) return snapshot

  switch (message.type) {
    case 'game.yacht_dice.score.update':
      return {
        ...snapshot,
        game: {
          ...game,
          scores: { ...game.scores, [message.payload.playerId]: message.payload.scoreboard },
        },
      }
    case 'game.yacht_dice.round.start':
      return {
        ...snapshot,
        game: {
          ...game,
          activePlayerId: message.payload.activePlayerId,
          roundDeadline: message.payload.deadline,
          roundNumber: message.payload.roundNumber,
          turnOrder: message.payload.turnOrder,
          rollCount: 0,
        },
      }
    case 'game.yacht_dice.game.over':
      return {
        ...snapshot,
        phase: 'finished',
        game: { ...game, rankings: message.payload.rankings },
      }
    default:
      return snapshot
  }
}
