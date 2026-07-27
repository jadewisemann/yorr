import { describe, expect, it, vi } from 'vitest'
import { buildClientMessage } from '@/realtime/wsEvents'
import { creatorSession, MOCK_ROOM_ID, participantSession } from './fixtures'
import { createRealtimeFixture } from './realtimeScenarios'

describe('FakeRealtimeClient scenarios', () => {
  it('방장과 참가자 세션을 독립 제공한다', () => {
    const creator = createRealtimeFixture({ role: 'creator' })
    const participant = createRealtimeFixture({ role: 'participant' })
    const creatorMessages = vi.fn()
    const participantMessages = vi.fn()
    creator.onMessage(creatorMessages)
    participant.onMessage(participantMessages)

    creator.send(buildClientMessage('room.join', { sessionToken: creatorSession.sessionToken }))
    participant.send(
      buildClientMessage('room.join', { sessionToken: participantSession.sessionToken }),
    )

    expect(creatorMessages.mock.calls[0]?.[0].payload.you).toBe(creatorSession.you)
    expect(participantMessages.mock.calls[0]?.[0].payload.you).toBe(participantSession.you)
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

    error.send(buildClientMessage('room.join', { sessionToken: creatorSession.sessionToken }))
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
    expect(duplicateListener.mock.calls.map(([message]) => message.type)).toEqual([
      'dice.broadcast',
      'dice.broadcast',
    ])
    expect(outOfOrderListener.mock.calls.map(([message]) => message.type)).toEqual([
      'round.end',
      'score.update',
    ])
  })

  it('굴림과 제출을 같은 게임 상태로 왕복한다', () => {
    const listener = vi.fn()
    const client = createRealtimeFixture({ role: 'participant' })
    client.onMessage(listener)

    client.send(
      buildClientMessage(
        'dice.roll',
        { dice: [1, 2, 3, 4, 5] },
        { roomId: MOCK_ROOM_ID, msgId: 'roll-1' },
      ),
    )
    client.send(
      buildClientMessage(
        'round.submit',
        {
          roundNumber: 1,
          dice: [1, 2, 3, 4, 5],
          category: 'choice',
        },
        { roomId: MOCK_ROOM_ID, msgId: 'submit-1' },
      ),
    )

    expect(listener.mock.calls.map(([message]) => message.type)).toEqual([
      'dice.broadcast',
      'score.update',
      'round.end',
    ])
    expect(listener.mock.calls[1]?.[0].payload.scoreboard.categories.choice).toBe(16)
  })

  it('재접속 snapshot을 제공하고 미처리 이벤트를 실패시킨다', () => {
    const listener = vi.fn()
    const client = createRealtimeFixture({ scenario: 'reconnect' })
    client.onMessage(listener)

    client.send(buildClientMessage('sys.reconnect', { sessionToken: creatorSession.sessionToken }))

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
