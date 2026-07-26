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
  const sessionToken = useAppStore((state) => state.roomSession?.sessionToken)

  useEffect(() => {
    if (!sessionToken) {
      client.disconnect()
      useAppStore.getState().setConnectionStatus('idle')
      return
    }

    let active = true
    let reconnecting = false
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
        useAppStore.getState().setConnectionStatus('connected')
        client.send(
          reconnecting
            ? buildClientMessage('sys.reconnect', { sessionToken })
            : buildClientMessage('room.join', { sessionToken }),
        )
        reconnecting = true
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
  }, [client, sessionToken])

  return children
}

function applyServerMessage(message: ServerMessage, startHeartbeat: (intervalMs: number) => void) {
  const store = useAppStore.getState()

  switch (message.type) {
    case 'sys.connected':
      startHeartbeat(message.payload.heartbeatIntervalMs)
      return
    case 'room.joined':
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
      return
    default:
      return
  }
}
