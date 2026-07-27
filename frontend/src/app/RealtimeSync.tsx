import { type ReactNode, useEffect } from 'react'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import { buildClientMessage, type ServerMessage } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'

interface RealtimeSyncProps {
  children: ReactNode
  client: RealtimeClient
}

const reconnectDelayMs = 1_000

export function RealtimeSync({ children, client }: RealtimeSyncProps) {
  const roomId = useAppStore((state) => state.roomSession?.roomId)
  const nickname = useAppStore((state) => state.roomSession?.nickname)

  useEffect(() => {
    if (!roomId || !nickname) {
      client.disconnect()
      useAppStore.getState().setConnectionStatus('idle')
      return
    }

    let active = true
    let hasConnected = false
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

        useAppStore.getState().setConnectionStatus('connected')
        client.send(
          hasConnected
            ? buildClientMessage('sys.reconnect', { sessionToken: roomSession.sessionToken })
            : buildClientMessage('room.join', {
                roomId: roomSession.roomId,
                nickname: roomSession.nickname,
                sessionToken: roomSession.sessionToken,
              }),
        )
        hasConnected = true
        return
      }

      stopHeartbeat()
      if (event === 'error') return

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
  }, [client, nickname, roomId])

  return children
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
          snapshot: message.payload.snapshot,
        })
        return
      }
      store.replaceRoomSnapshot(message.payload.snapshot)
      return
    case 'sys.reconnected':
    case 'state.sync':
      store.replaceRoomSnapshot(message.payload.snapshot)
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
    case 'room.closed':
      store.reset()
      useAppStore.getState().setAppNotice('방이 종료되어 홈으로 이동했어요.')
      return
    case 'error':
      if (
        message.payload.code === 'SESSION_EXPIRED' ||
        message.payload.code === 'AUTH_FAILED' ||
        message.payload.code === 'AUTH_REQUIRED'
      ) {
        store.reset()
        useAppStore.getState().setAppNotice('입장 정보가 만료됐어요. 방에 다시 참가해 주세요.')
      }
      return
    default:
      return
  }
}
