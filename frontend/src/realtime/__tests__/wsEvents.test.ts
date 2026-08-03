import { describe, expect, it, vi } from 'vitest'
import { serverMessage } from '@/mocks/fixtures'
import { buildClientMessage, isServer, WS_PROTOCOL_VERSION } from '@/realtime/wsEvents'

describe('isServer', () => {
  it('type이 일치할 때만 좁혀 준다', () => {
    const message = serverMessage('presence.update', { playerId: 'p1', status: 'away' })

    expect(isServer(message, 'presence.update')).toBe(true)
    expect(isServer(message, 'room.closed')).toBe(false)
  })
})

describe('buildClientMessage', () => {
  it('ts를 자동으로 채우고 payload를 그대로 싣는다', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_753_000_000_000)

    expect(buildClientMessage('sys.ping', { clientTs: 1 })).toEqual({
      type: 'sys.ping',
      ts: 1_753_000_000_000,
      payload: { clientTs: 1 },
    })

    vi.restoreAllMocks()
  })

  it('roomId·msgId는 넘긴 값만 봉투에 붙인다', () => {
    const withBoth = buildClientMessage(
      'room.ready',
      { ready: true },
      {
        roomId: 'YORR64',
        msgId: 'm-1',
      },
    )
    const withRoomOnly = buildClientMessage('room.ready', { ready: true }, { roomId: 'YORR64' })
    const withNeither = buildClientMessage('room.ready', { ready: true })

    expect(withBoth).toMatchObject({ roomId: 'YORR64', msgId: 'm-1' })
    expect(withRoomOnly).not.toHaveProperty('msgId')
    expect(withNeither).not.toHaveProperty('roomId')
    expect(withNeither).not.toHaveProperty('msgId')
  })
})

describe('프로토콜 버전', () => {
  it('FE가 기대하는 버전을 상수 하나로 고정한다', () => {
    expect(WS_PROTOCOL_VERSION).toBe(1)
  })
})
