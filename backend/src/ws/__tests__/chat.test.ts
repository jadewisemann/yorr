import { beforeEach, describe, expect, it } from 'vitest'
import { describeRedis, useRedis } from '../../../test/redisHarness.js'
import { RoomBroadcaster } from '../broadcaster.js'
import { CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS, ChatChannel } from '../chat.js'
import type { RoomMember } from '../registry.js'
import { FakeSocket, frame, useWsHandler } from './wsHarness.js'

/**
 * 텍스트 채팅 — 계약 문서는 docs/design/chat.md다. 실제 소켓 위 검증은
 * `gateway.test.ts`가 맡고, 여기서는 중계 규칙과 프로토콜 응답만 본다.
 */

/* -------------------------------------------------------------- 중계 규칙(순수) */

describe('ChatChannel', () => {
  let broadcaster: RoomBroadcaster
  let socket: FakeSocket
  let now: number
  let channel: ChatChannel

  const me = { playerId: 'player-a', nickname: '느긋한 주사위', roomId: 'room-a' } as RoomMember

  beforeEach(() => {
    broadcaster = new RoomBroadcaster()
    socket = new FakeSocket()
    broadcaster.register('room-a', socket)
    now = 1_753_000_000_000
    channel = new ChatChannel({ broadcaster, now: () => now })
  })

  it('앞뒤 공백을 다듬고 보낸 사람을 서버 값으로 채워 방 전원에게 방송한다', () => {
    expect(channel.send(me, '  먼저 굴려요  ')).toBeNull()

    expect(socket.only()).toMatchObject({
      type: 'chat.message',
      roomId: 'room-a',
      payload: {
        playerId: 'player-a',
        nickname: '느긋한 주사위',
        text: '먼저 굴려요',
        at: now,
      },
    })
  })

  it('빈 줄과 문자열이 아닌 값은 방송하지 않는다', () => {
    expect(channel.send(me, '   ')).toBe('empty')
    expect(channel.send(me, null)).toBe('empty')
    expect(channel.send(me, 42)).toBe('empty')

    expect(socket.sent).toEqual([])
  })

  it('상한을 넘긴 말은 자르지 않고 거절한다 — 잘린 말은 보낸 사람이 모른다', () => {
    expect(channel.send(me, 'ㄱ'.repeat(201))).toBe('too_long')

    expect(socket.sent).toEqual([])
    expect(channel.send(me, 'ㄱ'.repeat(200))).toBeNull()
  })

  it('창 안에서 한도를 넘기면 막고, 창이 지나면 다시 받는다', () => {
    for (let index = 0; index < CHAT_RATE_LIMIT; index += 1) {
      expect(channel.send(me, `줄 ${index}`)).toBeNull()
    }
    expect(channel.send(me, '한 줄 더')).toBe('rate_limited')

    // 거절된 시도는 창을 밀지 않는다 — 세면 도배하는 쪽이 영구히 막힌다.
    now += CHAT_RATE_WINDOW_MS
    expect(channel.send(me, '이제는 된다')).toBeNull()
  })

  it('한도는 사람마다 따로 센다', () => {
    const other = { ...me, playerId: 'player-b', nickname: '참가자' } as RoomMember
    for (let index = 0; index < CHAT_RATE_LIMIT; index += 1) channel.send(me, `줄 ${index}`)

    expect(channel.send(other, '나는 처음이다')).toBeNull()
  })
})

/* --------------------------------------------------------- 프로토콜 응답(핸들러) */

describeRedis('chat.send(GameSocketHandler)', () => {
  const ws = useWsHandler(useRedis())

  const chatFrame = (type: string, payload: unknown, msgId?: string): string =>
    frame(type, payload, { roomId: 'room-a', ...(msgId ? { msgId } : {}) })

  it('방에 들어온 사람의 말은 자기 자신을 포함한 방 전원에게 방송된다', async () => {
    const { roomCode, host } = await ws.openRoom()
    const hostSocket = await ws.enter(roomCode, host)

    await ws.handler.message(hostSocket, chatFrame('chat.send', { text: '안녕하세요' }, 'chat-a'))

    expect(hostSocket.only()).toMatchObject({
      type: 'chat.message',
      roomId: roomCode,
      payload: { playerId: host.userId, nickname: '호스트', text: '안녕하세요' },
    })
  })

  it('방에 들어오지 않은 소켓은 NOT_IN_ROOM으로 거절한다', async () => {
    const socket = new FakeSocket()

    await ws.handler.message(socket, chatFrame('chat.send', { text: '누구세요' }, 'chat-b'))

    expect(socket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'NOT_IN_ROOM', refMsgId: 'chat-b' },
    })
  })

  /** 도배와 잘못된 입력은 사용자가 고칠 방법이 달라서 코드를 나눈다. */
  it('도배는 RATE_LIMITED, 빈 줄은 INVALID_MESSAGE로 갈린다', async () => {
    const { roomCode, host } = await ws.openRoom()
    const hostSocket = await ws.enter(roomCode, host)

    await ws.handler.message(hostSocket, chatFrame('chat.send', { text: '' }, 'chat-c'))
    expect(hostSocket.only()).toMatchObject({
      type: 'error',
      payload: { code: 'INVALID_MESSAGE', refMsgId: 'chat-c' },
    })
    hostSocket.clear()

    for (let index = 0; index <= CHAT_RATE_LIMIT; index += 1) {
      await ws.handler.message(hostSocket, chatFrame('chat.send', { text: `줄 ${index}` }))
    }

    expect(hostSocket.messages().at(-1)).toMatchObject({
      type: 'error',
      payload: { code: 'RATE_LIMITED' },
    })
  })
})
