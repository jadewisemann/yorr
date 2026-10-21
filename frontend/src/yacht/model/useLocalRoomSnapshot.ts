import { useEffect, useState } from 'react'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import type { RoomSnapshot, ServerMessage } from '@/realtime/wsEvents'

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
      return withScore(game, snapshot, message.payload)
    case 'game.yacht_dice.round.start':
      return withRoundStart(game, snapshot, message.payload)
    case 'game.yacht_dice.game.over':
      return withGameOver(game, snapshot, message.payload)
    default:
      return snapshot
  }
}

/** 점수 갱신 — 한 사람의 점수판만 바꾸고 나머지는 그대로 둔다. */
function withScore(
  game: NonNullable<RoomSnapshot['game']>,
  snapshot: RoomSnapshot,
  payload: Extract<ServerMessage, { type: 'game.yacht_dice.score.update' }>['payload'],
): RoomSnapshot {
  return {
    ...snapshot,
    game: {
      ...game,
      scores: { ...game.scores, [payload.playerId]: payload.scoreboard },
    },
  }
}

/** 새 라운드 — 굴림 횟수는 0으로 돌아간다. */
function withRoundStart(
  game: NonNullable<RoomSnapshot['game']>,
  snapshot: RoomSnapshot,
  payload: Extract<ServerMessage, { type: 'game.yacht_dice.round.start' }>['payload'],
): RoomSnapshot {
  return {
    ...snapshot,
    game: {
      ...game,
      activePlayerId: payload.activePlayerId,
      roundDeadline: payload.deadline,
      roundNumber: payload.roundNumber,
      turnOrder: payload.turnOrder,
      rollCount: 0,
    },
  }
}

/** 판 종료 — 순위를 싣고 phase를 finished로 못 박는다. */
function withGameOver(
  game: NonNullable<RoomSnapshot['game']>,
  snapshot: RoomSnapshot,
  payload: Extract<ServerMessage, { type: 'game.yacht_dice.game.over' }>['payload'],
): RoomSnapshot {
  return { ...snapshot, phase: 'finished', game: { ...game, rankings: payload.rankings } }
}
