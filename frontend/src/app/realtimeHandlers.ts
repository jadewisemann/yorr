import type { GameCode } from '@/games'
import type { GameOverPayload, RoomSnapshot, ServerMessage } from '@/realtime/wsEvents'
import type { useAppStore } from '@/store'

/**
 * 서버 메시지 리듀서 — 봉투가 아니라 **payload**를 받아 스토어를 갱신한다.
 *
 * 왜 분리했나: `RealtimeSync`(연결 수명주기)와 이 리듀서들은 관심사가 다르다.
 * 연결은 소켓·타이머를 다루고, 리듀서는 와이어 payload를 스토어 모양으로 옮긴다.
 * 리듀서는 연결 없이도 시험할 수 있어야 한다.
 */

type Store = ReturnType<typeof useAppStore.getState>

export function keepGameState(snapshot: RoomSnapshot, current: RoomSnapshot | null): RoomSnapshot {
  if (snapshot.phase === 'waiting' || !current?.game) return snapshot
  if (snapshot.phase === 'finished' && current.phase === 'finished') {
    return { ...snapshot, players: current.players, game: current.game }
  }
  if (snapshot.game) return snapshot
  return { ...snapshot, game: current.game }
}

export function applyModuleGameState(
  payload: Extract<
    ServerMessage,
    { type: 'game.davinci_code.state' | 'game.ping_pong.state' | 'game.duel.state' }
  >['payload'],
  gameCode: GameCode,
  store: Store,
) {
  const snapshot = store.roomSnapshot
  if (snapshot?.gameCode !== gameCode) return
  store.replaceRoomSnapshot({
    ...snapshot,
    game: payload as unknown as NonNullable<RoomSnapshot['game']>,
  })
}

export function applyRoomJoined(
  payload: Extract<ServerMessage, { type: 'room.joined' }>['payload'],
  store: Store,
) {
  if (store.roomSession) {
    store.setRoomSession({
      ...store.roomSession,
      you: payload.you,
      sessionToken: payload.sessionToken,
      snapshot: keepGameState(payload.snapshot, store.roomSnapshot),
    })
    return
  }
  store.replaceRoomSnapshot(keepGameState(payload.snapshot, store.roomSnapshot))
}

export function applyPlayerJoined(
  payload: Extract<ServerMessage, { type: 'room.player_joined' }>['payload'],
  store: Store,
) {
  if (!store.roomSnapshot) return
  store.replaceRoomSnapshot({
    ...store.roomSnapshot,
    players: [
      ...store.roomSnapshot.players.filter((player) => player.playerId !== payload.player.playerId),
      payload.player,
    ],
  })
}

export function applyPlayerLeft(
  payload: Extract<ServerMessage, { type: 'room.player_left' }>['payload'],
  store: Store,
) {
  if (!store.roomSnapshot) return
  if (store.roomSnapshot.phase === 'finished') return
  store.replaceRoomSnapshot({
    ...store.roomSnapshot,
    players: store.roomSnapshot.players.filter((player) => player.playerId !== payload.playerId),
  })
}

export function applyPresenceUpdate(
  payload: Extract<ServerMessage, { type: 'presence.update' }>['payload'],
  store: Store,
) {
  if (!store.roomSnapshot) return
  store.replaceRoomSnapshot({
    ...store.roomSnapshot,
    players: store.roomSnapshot.players.map((player) =>
      player.playerId === payload.playerId ? { ...player, status: payload.status } : player,
    ),
  })
}

export function applyScoreUpdate(
  payload: Extract<ServerMessage, { type: 'game.yacht_dice.score.update' }>['payload'],
  store: Store,
) {
  if (!store.roomSnapshot?.game) return
  store.replaceRoomSnapshot({
    ...store.roomSnapshot,
    game: {
      ...store.roomSnapshot.game,
      scores: { ...store.roomSnapshot.game.scores, [payload.playerId]: payload.scoreboard },
    },
  })
}

export function applyRoundStart(
  payload: Extract<ServerMessage, { type: 'game.yacht_dice.round.start' }>['payload'],
  store: Store,
) {
  const snapshot = store.roomSnapshot
  if (!snapshot) return
  const current = snapshot.game
  const sameTurn =
    current?.roundNumber === payload.roundNumber &&
    current?.activePlayerId === payload.activePlayerId
  store.replaceRoomSnapshot({
    ...snapshot,
    game: {
      activePlayerId: payload.activePlayerId,
      roundDeadline: payload.deadline,
      roundNumber: payload.roundNumber,
      scores: current?.scores ?? {},
      turnOrder: payload.turnOrder,
      rollCount: sameTurn ? (current?.rollCount ?? 0) : 0,
      ...(sameTurn && current?.dice ? { dice: current.dice } : {}),
      ...(sameTurn && current?.held ? { held: current.held } : {}),
    },
  })
}

export function applyDiceBroadcast(
  message: Extract<ServerMessage, { type: 'game.yacht_dice.dice.broadcast' }>,
  store: Store,
) {
  const { payload } = message
  const snapshot = store.roomSnapshot
  if (
    !snapshot?.game ||
    (message.roomId !== undefined && message.roomId !== snapshot.roomId) ||
    snapshot.game.roundNumber !== payload.roundNumber ||
    snapshot.game.activePlayerId !== payload.playerId ||
    payload.rollCount < snapshot.game.rollCount
  ) {
    return
  }
  store.replaceRoomSnapshot({
    ...snapshot,
    game: {
      ...snapshot.game,
      rollCount: payload.rollCount,
      dice: payload.dice,
      held: payload.held,
    },
  })
}

export function applyGameOver(payload: GameOverPayload, store: Store) {
  const snapshot = store.roomSnapshot
  if (!snapshot) return
  const game = snapshot.game
  store.replaceRoomSnapshot({
    ...snapshot,
    phase: 'finished',
    ...(game ? { game: { ...game, rankings: payload.rankings } } : {}),
  })
}

export function applyServerError(
  payload: Extract<ServerMessage, { type: 'error' }>['payload'],
  store: Store,
) {
  if (
    payload.code === 'SESSION_EXPIRED' ||
    payload.code === 'AUTH_FAILED' ||
    payload.code === 'AUTH_REQUIRED'
  ) {
    store.endSession('expired')
  }
  if (payload.code === 'GAME_ALREADY_STARTED') {
    store.endSession('removed')
  }
  if (payload.code === 'ROOM_NOT_FOUND') {
    store.endSession('room_closed')
  }
}
