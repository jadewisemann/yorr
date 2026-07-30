import { type ReactNode, useEffect } from 'react'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import { buildClientMessage, type RoomSnapshot, type ServerMessage } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'

interface RealtimeSyncProps {
  children: ReactNode
  client: RealtimeClient
}

const reconnectDelayMs = 1_000
/** 이 횟수만큼 연속으로 재연결에 실패하면 세션을 포기한다(FSM: any → idle). */
const maxReconnectAttempts = 10

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
        } catch {
          // The connection listener schedules recovery when the transport closes.
        }
      }, intervalMs)
    }

    const unsubscribeMessage = client.onMessage((message) => {
      if (!active) return
      applyServerMessage(message, startHeartbeat)
    })

    const unsubscribeConnection = client.onConnectionChange((event) => {
      if (!active) return

      if (event === 'open') {
        const roomSession = useAppStore.getState().roomSession
        if (!roomSession) return

        reconnectAttempts = 0
        useAppStore.getState().setConnectionStatus('connected')
        // 재접속도 room.join으로 통일한다. 서버가 sessionToken으로 기존 정체성을 복원하며,
        // sys.reconnect는 아직 서버에 라우팅이 없어 보내면 조용히 버려진다(티켓 25에서 이관).
        client.send(
          buildClientMessage('room.join', {
            roomId: roomSession.roomId,
            nickname: roomSession.nickname,
            sessionToken: roomSession.sessionToken,
          }),
        )
        return
      }

      stopHeartbeat()
      if (event === 'error') return

      reconnectAttempts += 1
      if (reconnectAttempts > maxReconnectAttempts) {
        useAppStore.getState().endSession('disconnected')
        return
      }

      useAppStore.getState().setConnectionStatus('reconnecting')
      reconnectTimer = setTimeout(() => {
        if (active) client.connect()
      }, reconnectDelayMs)
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

/**
 * 서버의 전체 스냅샷(state.sync · room.joined · sys.reconnected)에는 게임 진행 상태(game)가 실려
 * 있지 않다. 그대로 갈아끼우면 score.update로 모아온 **모든 플레이어의 점수판**이 통째로 사라지고,
 * game이 없는 동안 도착한 score.update는 아래 핸들러에서 그냥 버려진다.
 * 대기방으로 되돌아가는 경우가 아니면 지금 들고 있는 진행 상태를 유지한다.
 */
function keepGameState(snapshot: RoomSnapshot, current: RoomSnapshot | null): RoomSnapshot {
  if (snapshot.game || snapshot.phase === 'waiting' || !current?.game) return snapshot
  return { ...snapshot, game: current.game }
}

function applyServerMessage(message: ServerMessage, startHeartbeat: (intervalMs: number) => void) {
  const store = useAppStore.getState()

  switch (message.type) {
    case 'sys.connected':
      startHeartbeat(message.payload.heartbeatIntervalMs)
      return
    case 'room.joined':
      if (store.roomSession) {
        store.setRoomSession({
          ...store.roomSession,
          you: message.payload.you,
          sessionToken: message.payload.sessionToken,
          snapshot: keepGameState(message.payload.snapshot, store.roomSnapshot),
        })
        return
      }
      store.replaceRoomSnapshot(keepGameState(message.payload.snapshot, store.roomSnapshot))
      return
    case 'sys.reconnected':
    case 'state.sync':
      store.replaceRoomSnapshot(keepGameState(message.payload.snapshot, store.roomSnapshot))
      return
    case 'room.player_joined':
      if (!store.roomSnapshot) return
      store.replaceRoomSnapshot({
        ...store.roomSnapshot,
        players: [
          ...store.roomSnapshot.players.filter(
            (player) => player.playerId !== message.payload.player.playerId,
          ),
          message.payload.player,
        ],
      })
      return
    case 'room.player_left':
      if (!store.roomSnapshot) return
      store.replaceRoomSnapshot({
        ...store.roomSnapshot,
        players: store.roomSnapshot.players.filter(
          (player) => player.playerId !== message.payload.playerId,
        ),
      })
      return
    case 'presence.update':
      if (!store.roomSnapshot) return
      store.replaceRoomSnapshot({
        ...store.roomSnapshot,
        players: store.roomSnapshot.players.map((player) =>
          player.playerId === message.payload.playerId
            ? { ...player, status: message.payload.status }
            : player,
        ),
      })
      return
    case 'score.update':
      if (!store.roomSnapshot?.game) return
      store.replaceRoomSnapshot({
        ...store.roomSnapshot,
        game: {
          ...store.roomSnapshot.game,
          scores: {
            ...store.roomSnapshot.game.scores,
            [message.payload.playerId]: message.payload.scoreboard,
          },
        },
      })
      return
    /**
     * round.start는 새 턴에만 오는 게 아니다 — 서버는 굴림마다 마감을 연장하며 같은 턴에도
     * 다시 보낸다. 그래서 굴림 진행을 무조건 0으로 되돌리면 안 된다. 턴이 실제로 바뀌었을
     * 때만 초기화하고, 같은 턴이면 지금까지의 진행을 그대로 들고 간다.
     */
    case 'round.start': {
      const snapshot = store.roomSnapshot
      if (!snapshot) return
      const current = snapshot.game
      const sameTurn =
        current?.roundNumber === message.payload.roundNumber &&
        current?.activePlayerId === message.payload.activePlayerId
      store.replaceRoomSnapshot({
        ...snapshot,
        game: {
          activePlayerId: message.payload.activePlayerId,
          roundDeadline: message.payload.deadline,
          roundNumber: message.payload.roundNumber,
          scores: current?.scores ?? {},
          turnOrder: message.payload.turnOrder,
          rollCount: sameTurn ? (current?.rollCount ?? 0) : 0,
          ...(sameTurn && current?.dice ? { dice: current.dice } : {}),
          ...(sameTurn && current?.held ? { held: current.held } : {}),
        },
      })
      return
    }
    /**
     * 굴림 진행의 권위값은 서버다. 스냅샷 갱신을 여기서 해두면 턴 중간에 마운트된 화면도
     * (재접속 직후처럼) 서버와 같은 굴림 횟수에서 이어갈 수 있다.
     */
    case 'dice.broadcast': {
      const snapshot = store.roomSnapshot
      if (!snapshot?.game || snapshot.game.roundNumber !== message.payload.roundNumber) return
      store.replaceRoomSnapshot({
        ...snapshot,
        game: {
          ...snapshot.game,
          rollCount: message.payload.rollCount,
          dice: message.payload.dice,
          held: message.payload.held,
        },
      })
      return
    }
    /**
     * 게임 종료. 이 핸들러가 없으면 서버가 종료를 알려도 화면이 계속 게임에 머문다.
     * 뒤따르는 state.sync도 phase를 finished로 바꾸지만, 순서에 의존하지 않도록 여기서도 바꾼다.
     */
    case 'game.over': {
      const snapshot = store.roomSnapshot
      if (!snapshot) return
      const game = snapshot.game
      store.replaceRoomSnapshot({
        ...snapshot,
        phase: 'finished',
        ...(game ? { game: { ...game, rankings: message.payload.rankings } } : {}),
      })
      return
    }
    case 'room.closed':
      store.endSession('room_closed')
      return
    case 'error':
      if (
        message.payload.code === 'SESSION_EXPIRED' ||
        message.payload.code === 'AUTH_FAILED' ||
        message.payload.code === 'AUTH_REQUIRED'
      ) {
        store.endSession('expired')
      }
      // 오프라인 자동 퇴장 뒤의 재접속 room.join은 이 코드로 거절된다(신규 참가는 REST에서
      // 이미 막힌다). 세션을 끝내지 않으면 게임 화면이 갱신 없이 영원히 멈춘다.
      if (message.payload.code === 'GAME_ALREADY_STARTED') {
        store.endSession('removed')
      }
      // 유예가 끝나 서버가 방을 닫은 뒤의 "이어서 하기". 저장된 세션은 이미 쓸 수 없으므로
      // 정리해 홈으로 보낸다 — 안 그러면 배너가 계속 뜨고 누를 때마다 같은 실패를 반복한다.
      if (message.payload.code === 'ROOM_NOT_FOUND') {
        store.endSession('room_closed')
      }
      return
    default:
      return
  }
}
