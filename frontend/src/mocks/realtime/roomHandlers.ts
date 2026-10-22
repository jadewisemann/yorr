import type { FakeMessageHandlers } from '@/realtime/fakeRealtimeClient'
import type { ClientMessage, RoomSnapshot, ServerMessage } from '@/realtime/wsEvents'
import {
  dashboardSession,
  MOCK_ROOM_ID,
  MOCK_ROUND_DURATION_MS,
  participantSession,
  serverMessage,
  waitingRoomSnapshot,
} from '../fixtures'
import { loadMockRoomSnapshot } from '../mockRoomState'
import type { RealtimeContext } from './context'

type JoinMessage = Extract<ClientMessage, { type: 'room.join' }>
type ChatMessage = Extract<ClientMessage, { type: 'chat.send' }>
type ReadyMessage = Extract<ClientMessage, { type: 'room.ready' }>

/** 방 입장·채팅·준비 상태. */
export function roomHandlers(context: RealtimeContext): FakeMessageHandlers {
  return {
    'room.join': (message) => joinRoom(message, context),
    'chat.send': (message) => relayChat(message, context),
    'room.ready': (message) => changeReady(message, context),
  }
}

function joinRoom(message: JoinMessage, context: RealtimeContext): ServerMessage[] {
  if (context.scenario === 'error') {
    return [
      serverMessage('error', {
        code: 'ROOM_FULL',
        message: '방 정원이 가득 찼습니다.',
        ...(message.msgId === undefined ? {} : { refMsgId: message.msgId }),
      }),
    ]
  }

  const session = identityOf(message.payload.sessionToken, context)
  return [
    serverMessage(
      'room.joined',
      {
        you: session.you,
        sessionToken: session.sessionToken,
        snapshot: joinedSnapshotFor(session.snapshot),
      },
      { roomId: session.roomId, msgId: message.msgId },
    ),
  ]
}

/*
 * 채팅은 mock에서도 **되돌려 준다**. 서버가 하는 일이 중계뿐이라(wsEvents.ts의 chat 절)
 * 보낸 말을 그대로 방송하면 실제 서버와 같은 흐름이 되고, 이것이 없으면 strict 모드가
 * 던져 mock으로 도는 화면에서 채팅이 아무 반응 없이 사라진다.
 */
function relayChat(message: ChatMessage, context: RealtimeContext): ServerMessage[] {
  context.chatSequence += 1
  return [
    serverMessage(
      'chat.message',
      {
        messageId: `mock-chat-${context.chatSequence}`,
        playerId: context.session.you,
        nickname: context.session.nickname,
        text: message.payload.text,
        at: Date.now(),
      },
      { roomId: MOCK_ROOM_ID },
    ),
  ]
}

function changeReady(message: ReadyMessage, context: RealtimeContext): ServerMessage[] {
  return [
    serverMessage(
      'room.ready_changed',
      { playerId: context.session.you, ready: message.payload.ready },
      { roomId: MOCK_ROOM_ID, msgId: message.msgId },
    ),
  ]
}

/**
 * 정체성은 실서버처럼 sessionToken으로 가른다 — 모르는 토큰을 creator로 떨어뜨리면
 * 대시보드가 플레이어 정체성을 받아 자기 턴이 된다.
 */
function identityOf(sessionToken: string, context: RealtimeContext) {
  if (sessionToken === participantSession.sessionToken) return participantSession
  if (sessionToken === dashboardSession.sessionToken) return dashboardSession
  return context.session
}

/** 저장된 방이 진행 중이면 제한 시간을 지금 기준으로 다시 잡아 준다. */
function joinedSnapshotFor(fallback: RoomSnapshot | null): RoomSnapshot {
  const stored = loadMockRoomSnapshot()
  if (stored?.game) {
    return {
      ...stored,
      game: { ...stored.game, roundDeadline: Date.now() + MOCK_ROUND_DURATION_MS },
    }
  }
  return stored ?? fallback ?? waitingRoomSnapshot
}
