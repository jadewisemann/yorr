import { describe, expect, it, vi } from 'vitest'
import { buildClientMessage } from '@/realtime/wsEvents'
import { guestSession, hostSession, MOCK_ROOM_ID } from './fixtures'
import { createRealtimeFixture } from './realtimeScenarios'

describe('FakeRealtimeClient scenarios', () => {
  it('방장과 참가자 세션을 독립 제공한다', () => {
    const host = createRealtimeFixture({ role: 'host' })
    const guest = createRealtimeFixture({ role: 'guest' })
    const hostMessages = vi.fn()
    const guestMessages = vi.fn()
    host.onMessage(hostMessages)
    guest.onMessage(guestMessages)

    host.send(buildClientMessage('room.join', { roomId: MOCK_ROOM_ID, nickname: '방장' }))
    guest.send(buildClientMessage('room.join', { roomId: MOCK_ROOM_ID, nickname: '참가자' }))

    expect(hostMessages.mock.calls[0]?.[0].payload.you).toBe(hostSession.you)
    expect(guestMessages.mock.calls[0]?.[0].payload.you).toBe(guestSession.you)
  })

  it('오류·중복·역순 시나리오를 선택할 수 있다', () => {
    const errorListener = vi.fn()
    const duplicateListener = vi.fn()
    const outOfOrderListener = vi.fn()
    const error = createRealtimeFixture({ scenario: 'error' })
    const duplicate = createRealtimeFixture({ scenario: 'duplicate' })
    const outOfOrder = createRealtimeFixture({ scenario: 'out-of-order' })
    error.onMessage(errorListener)
    duplicate.onMessage(duplicateListener)
    outOfOrder.onMessage(outOfOrderListener)

    error.send(buildClientMessage('room.join', { roomId: MOCK_ROOM_ID, nickname: '방장' }))
    duplicate.send(buildClientMessage('dice.roll', { dice: [1, 2, 3, 4, 5] }))
    outOfOrder.send(
      buildClientMessage('round.submit', {
        roundNumber: 1,
        dice: [1, 2, 3, 4, 6],
        category: 'choice',
      }),
    )

    expect(errorListener.mock.calls[0]?.[0].type).toBe('error')
    expect(duplicateListener).toHaveBeenCalledTimes(2)
    expect(outOfOrderListener.mock.calls.map(([message]) => message.type)).toEqual([
      'round.end',
      'score.update',
    ])
  })

  it('재접속 snapshot을 제공하고 미처리 이벤트를 실패시킨다', () => {
    const listener = vi.fn()
    const client = createRealtimeFixture({ scenario: 'reconnect' })
    client.onMessage(listener)

    client.send(buildClientMessage('sys.reconnect', { sessionToken: hostSession.sessionToken }))

    expect(listener.mock.calls[0]?.[0].type).toBe('sys.reconnected')
    expect(() =>
      client.send(buildClientMessage('room.leave', {}, { roomId: MOCK_ROOM_ID })),
    ).toThrow('Unhandled fake realtime event: room.leave')
  })

  it('지연 시나리오를 선택할 수 있다', () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const client = createRealtimeFixture({ scenario: 'delay', delayMs: 200 })
    client.onMessage(listener)

    client.send(buildClientMessage('sys.ping', { clientTs: 100 }))
    expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(listener).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
