import { useEffect } from 'react'
import type { RealtimeClient } from '@/realtime/realtimeClient'
import { buildClientMessage, type ServerMessage } from '@/realtime/wsEvents'
import { MAX_RECONNECT_ATTEMPTS, RECONNECT_DELAY_MS } from '@/room/connectSequence'
import { useAppStore } from '@/store'
import { createMessageDispatcher } from './messageDispatch'
import {
  applyDiceBroadcast,
  applyGameOver,
  applyModuleGameState,
  applyPlayerJoined,
  applyPlayerLeft,
  applyPresenceUpdate,
  applyRoomJoined,
  applyRoundStart,
  applyScoreUpdate,
  applyServerError,
  keepGameState,
} from './realtimeHandlers'

/**
 * 실시간 연결의 수명주기 — 접속·하트비트·재접속·메시지 디스패치.
 *
 * 왜 훅으로 뺐나: `RealtimeSync`가 이 80줄과 렌더를 함께 들고 있어 100줄이었다.
 * 여기 있는 것은 전부 **타이머와 소켓**이라 렌더와 무관하고, 재접속 정책
 * (`MAX_RECONNECT_ATTEMPTS`·`RECONNECT_DELAY_MS`)이 한 화면에 모인다.
 *
 * 방이 없으면 연결하지 않는다 — 로그인 전에 소켓을 열면 서버가 인증 없이 붙은
 * 소켓을 정리해야 하고, 클라이언트도 상태를 어디에 둘지 애매해진다.
 */
export const useRealtimeConnection = (client: RealtimeClient): void => {
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
    const heartbeat = createHeartbeat(client)
    const reconnect = createReconnectPolicy(client, () => active)

    const dispatch = createMessageDispatcher({
      startHeartbeat: heartbeat.start,
      keepGameState,
      applyRoomJoined,
      applyPlayerJoined,
      applyPlayerLeft,
      applyPresenceUpdate,
      applyScoreUpdate,
      applyRoundStart,
      applyDiceBroadcast,
      applyGameOver,
      applyModuleGameState,
      applyServerError,
    })

    const unsubscribeMessage = client.onMessage((message) => {
      if (!active) return
      dispatch(message, useAppStore.getState())
      if (isRoomReadyMessage(message)) {
        reconnect.reset()
        useAppStore.getState().setConnectionStatus('connected')
      }
    })

    const unsubscribeConnection = client.onConnectionChange((event) => {
      if (!active) return

      if (event === 'open') {
        reconnect.cancel()
        rejoinRoom(client)
        return
      }

      heartbeat.stop()
      if (event !== 'error') reconnect.schedule()
    })

    useAppStore.getState().setConnectionStatus('connecting')
    client.connect()

    return () => {
      active = false
      reconnect.cancel()
      heartbeat.stop()
      unsubscribeMessage()
      unsubscribeConnection()
      client.disconnect()
    }
  }, [client, nickname, roomId, roomResumeReason])
}

/**
 * 하트비트 타이머. 서버가 `sys.connected`로 간격을 알려 주고, 그 전에는 돌지 않는다.
 */
function createHeartbeat(client: RealtimeClient) {
  let timer: ReturnType<typeof setInterval> | undefined
  return {
    start(intervalMs: number) {
      if (timer) clearInterval(timer)
      timer = setInterval(() => ping(client), intervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
    },
  }
}

/**
 * 재접속 정책 — 시도 횟수를 세고, 한도를 넘으면 세션을 끝낸다.
 *
 * 한도가 있는 이유: 무한 재시도는 죽은 서버 앞에서 영원히 도는 탭이 된다. 세션을
 * 끝내면 사용자가 명시적으로 다시 시작한다.
 */
function createReconnectPolicy(client: RealtimeClient, isActive: () => boolean) {
  let attempts = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    schedule() {
      if (timer) return
      attempts += 1
      if (attempts > MAX_RECONNECT_ATTEMPTS) {
        useAppStore.getState().endSession('disconnected')
        return
      }
      useAppStore.getState().setConnectionStatus('reconnecting')
      timer = setTimeout(() => {
        timer = undefined
        if (isActive()) client.connect()
      }, RECONNECT_DELAY_MS)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = undefined
    },
    reset() {
      attempts = 0
    },
  }
}

/** 하트비트 한 번. 전송 실패는 삼킨다 — 죽은 소켓 정리는 close 경로가 맡는다. */
function ping(client: RealtimeClient): void {
  try {
    client.send(buildClientMessage('sys.ping', { clientTs: Date.now() }))
  } catch {
    // 다음 하트비트가 다시 시도한다 — 여기서 던지면 타이머만 남는다.
  }
}

/** 접속이 끊긴 뒤 같은 방·같은 세션으로 다시 앉는다. */
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

/** 이 메시지를 받으면 연결이 정상이라고 본다 — 재시도 카운터를 여기서만 되돌린다. */
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
