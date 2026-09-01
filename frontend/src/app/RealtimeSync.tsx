import { type ReactNode, useEffect } from 'react'
import type { GameCode } from '@/games'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import {
  buildClientMessage,
  type GameOverPayload,
  type RoomSnapshot,
  type ServerMessage,
} from '@/realtime/wsEvents'
import { MAX_RECONNECT_ATTEMPTS, RECONNECT_DELAY_MS } from '@/room/connectSequence'
import { useAppStore } from '@/store'

interface RealtimeSyncProps {
  children: ReactNode
  client: RealtimeClient
}

/*
 * 200줄 기준선 초과(원칙 7)를 알고 유지한다 — 소켓 수명주기와 서버 메시지
 * 리듀서(apply* 가족)가 한 파일인 것은, 와이어 계약 동결이 풀리면 PLANS의 이관
 * 티켓(envelope 게임 무관화 · sys.reconnect 라우팅)이 이 파일을 통째로 다시
 * 가르기 때문이다. 그 전에 구조를 흔들면 이관 diff에서 "계약이 어떻게 바뀌었나"가
 * 파일 이동에 묻힌다. 갈 거면 이관과 함께 간다.
 */
export function RealtimeSync({ children, client }: RealtimeSyncProps) {
  const roomId = useAppStore((state) => state.roomSession?.roomId)
  const nickname = useAppStore((state) => state.roomSession?.nickname)
  const roomResumeReason = useAppStore((state) => state.roomResumeReason)

  useEffect(() => {
    if (!roomId || !nickname || roomResumeReason) {
      client.disconnect()
      if (!roomResumeReason) useAppStore.getState().setConnectionStatus('idle')
      return
    }

    let active = true
    let reconnectAttempts = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined

    const stopHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
    }

    const startHeartbeat = (intervalMs: number) => {
      stopHeartbeat()
      heartbeatTimer = setInterval(() => {
        try {
          client.send(buildClientMessage('sys.ping', { clientTs: Date.now() }))
        } catch {}
      }, intervalMs)
    }

    const scheduleReconnect = () => {
      if (reconnectTimer) return
      reconnectAttempts += 1
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        useAppStore.getState().endSession('disconnected')
        return
      }

      useAppStore.getState().setConnectionStatus('reconnecting')
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined
        if (active) client.connect()
      }, RECONNECT_DELAY_MS)
    }

    const unsubscribeMessage = client.onMessage((message) => {
      if (!active) return
      applyServerMessage(message, startHeartbeat)
      if (isRoomReadyMessage(message)) {
        reconnectAttempts = 0
        useAppStore.getState().setConnectionStatus('connected')
      }
    })

    const unsubscribeConnection = client.onConnectionChange((event) => {
      if (!active) return

      if (event === 'open') {
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = undefined
        rejoinRoom(client)
        return
      }

      stopHeartbeat()
      if (event !== 'error') scheduleReconnect()
    })

    useAppStore.getState().setConnectionStatus('connecting')
    client.connect()

    return () => {
      active = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      stopHeartbeat()
      unsubscribeMessage()
      unsubscribeConnection()
      client.disconnect()
    }
  }, [client, nickname, roomId, roomResumeReason])

  return <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>
}

function rejoinRoom(client: RealtimeClient): boolean {
  const roomSession = useAppStore.getState().roomSession
  if (!roomSession) return false

  client.send(
    buildClientMessage('room.join', {
      roomId: roomSession.roomId,
      nickname: roomSession.nickname,
      sessionToken: roomSession.sessionToken,
    }),
  )
  return true
}

function isRoomReadyMessage(message: ServerMessage) {
  return (
    message.type === 'room.joined' ||
    message.type === 'state.sync' ||
    message.type === 'game.yacht_dice.state.sync' ||
    message.type === 'game.ping_pong.state.sync' ||
    message.type === 'game.duel.state.sync' ||
    message.type === 'game.davinci_code.state.sync' ||
    message.type === 'sys.reconnected'
  )
}

function keepGameState(snapshot: RoomSnapshot, current: RoomSnapshot | null): RoomSnapshot {
  if (snapshot.phase === 'waiting' || !current?.game) return snapshot
  if (snapshot.phase === 'finished' && current.phase === 'finished') {
    return { ...snapshot, players: current.players, game: current.game }
  }
  if (snapshot.game) return snapshot
  return { ...snapshot, game: current.game }
}

/*
 * 디스패치를 셋으로 가른 이유는 분기 수 자체다. 한 switch에 24개 case를 두면
 * 사이클로매틱 복잡도가 24가 되어 기준(22)을 넘는데, 갈래가 실제로 셋이라
 * (세션·방·게임) 나누면 각 함수가 자기 갈래만 안다. 처리했으면 true를 돌려주는
 * 규약이라 앞선 갈래가 먹은 메시지를 뒤가 다시 보지 않는다.
 */
function applyServerMessage(message: ServerMessage, startHeartbeat: (intervalMs: number) => void) {
  const store = useAppStore.getState()
  if (applySessionMessage(message, store, startHeartbeat)) return
  if (applyRoomMessage(message, store)) return
  applyGameMessage(message, store)
}

/** 연결 수명과 방 전체 스냅샷 교체. 게임 종류와 무관한 갈래다. */
function applySessionMessage(
  message: ServerMessage,
  store: Store,
  startHeartbeat: (intervalMs: number) => void,
): boolean {
  switch (message.type) {
    case 'sys.connected':
      startHeartbeat(message.payload.heartbeatIntervalMs)
      return true
    case 'sys.reconnected':
    case 'state.sync':
    case 'game.yacht_dice.state.sync':
    case 'game.ping_pong.state.sync':
    case 'game.duel.state.sync':
    case 'game.davinci_code.state.sync':
      store.replaceRoomSnapshot(keepGameState(message.payload.snapshot, store.roomSnapshot))
      return true
    case 'room.closed':
      store.endSession('room_closed')
      return true
    case 'error':
      applyServerError(message.payload, store)
      return true
    default:
      return false
  }
}

/** 명단과 접속 상태. */
function applyRoomMessage(message: ServerMessage, store: Store): boolean {
  switch (message.type) {
    case 'room.joined':
      applyRoomJoined(message.payload, store)
      return true
    case 'room.player_joined':
      applyPlayerJoined(message.payload, store)
      return true
    case 'room.player_left':
      applyPlayerLeft(message.payload, store)
      return true
    case 'presence.update':
      applyPresenceUpdate(message.payload, store)
      return true
    default:
      return false
  }
}

/** 게임 진행. 어느 게임인지는 메시지 타입이 말한다. */
function applyGameMessage(message: ServerMessage, store: Store): void {
  switch (message.type) {
    case 'game.yacht_dice.score.update':
      applyScoreUpdate(message.payload, store)
      return
    case 'game.yacht_dice.round.start':
      applyRoundStart(message.payload, store)
      return
    case 'game.yacht_dice.dice.broadcast':
      applyDiceBroadcast(message, store)
      return
    case 'game.yacht_dice.game.over':
    case 'game.ping_pong.game.over':
    case 'game.duel.game.over':
    case 'game.davinci_code.game.over':
      applyGameOver(message.payload, store)
      return
    case 'game.ping_pong.state':
      applyModuleGameState(message.payload, 'PING_PONG', store)
      return
    case 'game.duel.state':
      applyModuleGameState(message.payload, 'DUEL', store)
      return
    case 'game.davinci_code.state':
      applyModuleGameState(message.payload, 'DAVINCI_CODE', store)
      return
    default:
      return
  }
}

function applyModuleGameState(
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

type Store = ReturnType<typeof useAppStore.getState>

function applyRoomJoined(
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

function applyPlayerJoined(
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

function applyPlayerLeft(
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

function applyPresenceUpdate(
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

function applyScoreUpdate(
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

function applyRoundStart(
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

function applyDiceBroadcast(
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

function applyGameOver(payload: GameOverPayload, store: Store) {
  const snapshot = store.roomSnapshot
  if (!snapshot) return
  const game = snapshot.game
  store.replaceRoomSnapshot({
    ...snapshot,
    phase: 'finished',
    ...(game ? { game: { ...game, rankings: payload.rankings } } : {}),
  })
}

function applyServerError(
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
