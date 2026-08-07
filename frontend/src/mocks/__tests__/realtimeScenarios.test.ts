import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPlayingRoomSnapshot,
  creatorSession,
  dashboardSession,
  MOCK_ROOM_ID,
  participantSession,
} from '@/mocks/fixtures'
import {
  clearMockRoomSnapshot,
  loadMockRoomSnapshot,
  saveMockRoomSnapshot,
} from '@/mocks/mockRoomState'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { buildClientMessage } from '@/realtime/wsEvents'

describe('FakeRealtimeClient scenarios', () => {
  // 기억된 방 상태가 테스트 사이로 새면 room.join 응답이 순서에 따라 달라진다.
  beforeEach(() => clearMockRoomSnapshot())

  it('방장과 참가자 세션을 독립 제공한다', () => {
    const creator = createRealtimeFixture({ role: 'creator' })
    const participant = createRealtimeFixture({ role: 'participant' })
    const creatorMessages = vi.fn()
    const participantMessages = vi.fn()
    creator.onMessage(creatorMessages)
    participant.onMessage(participantMessages)

    creator.send(
      buildClientMessage('room.join', {
        roomId: creatorSession.roomId,
        nickname: creatorSession.nickname,
        sessionToken: creatorSession.sessionToken,
      }),
    )
    participant.send(
      buildClientMessage('room.join', {
        roomId: participantSession.roomId,
        nickname: participantSession.nickname,
        sessionToken: participantSession.sessionToken,
      }),
    )

    expect(creatorMessages.mock.calls[0]?.[0].payload.you).toBe(creatorSession.you)
    expect(participantMessages.mock.calls[0]?.[0].payload.you).toBe(participantSession.you)
  })

  /**
   * 파티 모드 대시보드는 <b>플레이어 정체성을 받아선 안 된다.</b>
   *
   * room.joined의 you가 곧 클라이언트의 정체성이 된다(RealtimeSync의 applyRoomJoined가
   * roomSession.you를 이 값으로 덮는다). 모르는 토큰을 creator로 떨어뜨리던 시절엔 대시보드가
   * player-creator를 받아 isMyTurn이 참이 되고, 플레이어가 아니어야 할 화면에서 주사위가 눌렸다.
   */
  it('대시보드 토큰에는 대시보드 정체성을 돌려준다', () => {
    const dashboard = createRealtimeFixture()
    const messages = vi.fn()
    dashboard.onMessage(messages)

    dashboard.send(
      buildClientMessage('room.join', {
        roomId: dashboardSession.roomId,
        nickname: dashboardSession.nickname,
        sessionToken: dashboardSession.sessionToken,
      }),
    )

    const you = messages.mock.calls[0]?.[0].payload.you
    expect(you).toBe(dashboardSession.you)
    expect(you).not.toBe(creatorSession.you)
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

    error.send(
      buildClientMessage('room.join', {
        roomId: creatorSession.roomId,
        nickname: creatorSession.nickname,
        sessionToken: creatorSession.sessionToken,
      }),
    )
    duplicate.send(
      buildClientMessage('game.yacht_dice.dice.roll', {
        held: [false, false, false, false, false],
        rollCount: 1,
        roundNumber: 1,
      }),
    )
    outOfOrder.send(
      buildClientMessage('game.yacht_dice.round.submit', {
        roundNumber: 1,
        dice: [1, 2, 3, 4, 6],
        category: 'choice',
      }),
    )

    expect(errorListener.mock.calls[0]?.[0].type).toBe('error')
    expect(duplicateListener).toHaveBeenCalledTimes(2)
    expect(duplicateListener.mock.calls.map(([message]) => message.type)).toEqual([
      'game.yacht_dice.dice.broadcast',
      'game.yacht_dice.dice.broadcast',
    ])
    expect(outOfOrderListener.mock.calls.map(([message]) => message.type)).toEqual([
      'game.yacht_dice.round.end',
      'game.yacht_dice.score.update',
    ])
  })

  it('굴림과 제출을 같은 게임 상태로 왕복한다', () => {
    const listener = vi.fn()
    const client = createRealtimeFixture({ role: 'participant' })
    client.onMessage(listener)

    client.send(
      buildClientMessage(
        'game.yacht_dice.dice.roll',
        { held: [false, false, false, false, false], rollCount: 1, roundNumber: 1 },
        { roomId: MOCK_ROOM_ID, msgId: 'roll-1' },
      ),
    )
    client.send(
      buildClientMessage(
        'game.yacht_dice.round.submit',
        {
          roundNumber: 1,
          dice: [1, 2, 3, 4, 5],
          category: 'choice',
        },
        { roomId: MOCK_ROOM_ID, msgId: 'submit-1' },
      ),
    )

    expect(listener.mock.calls.map(([message]) => message.type)).toEqual([
      'game.yacht_dice.dice.broadcast',
      'game.yacht_dice.score.update',
      'game.yacht_dice.round.end',
    ])
    // 정적 후보값이 아니라 제출된 주사위 [1,2,3,4,5]로 계산한 점수(choice = 합 15)다.
    expect(listener.mock.calls[1]?.[0].payload.scoreboard.categories.choice).toBe(15)
    expect(listener.mock.calls[1]?.[0].payload.scoreboard.total).toBe(15)
  })

  it('room.join은 기억된 진행 중 방 상태를 새 마감 시각과 함께 복원한다', () => {
    const staleDeadline = Date.now() - 60_000
    saveMockRoomSnapshot(createPlayingRoomSnapshot(staleDeadline))
    const listener = vi.fn()
    const client = createRealtimeFixture()
    client.onMessage(listener)

    client.send(
      buildClientMessage('room.join', {
        roomId: creatorSession.roomId,
        nickname: creatorSession.nickname,
        sessionToken: creatorSession.sessionToken,
      }),
    )

    const snapshot = listener.mock.calls[0]?.[0].payload.snapshot
    expect(snapshot.phase).toBe('playing')
    expect(snapshot.game.roundDeadline).toBeGreaterThan(Date.now())
  })

  it('제출한 점수는 기억된 방 상태에 남아 재접속 스냅샷에 복원된다', () => {
    saveMockRoomSnapshot(createPlayingRoomSnapshot(Date.now() + 30_000))
    const client = createRealtimeFixture({ role: 'participant' })

    client.send(
      buildClientMessage(
        'game.yacht_dice.round.submit',
        { roundNumber: 1, dice: [6, 6, 6, 2, 2], category: 'fullHouse' },
        { roomId: MOCK_ROOM_ID, msgId: 'submit-1' },
      ),
    )

    const stored = loadMockRoomSnapshot()
    expect(stored?.game?.scores[participantSession.you]?.categories.fullHouse).toBe(22)
    expect(stored?.game?.scores[participantSession.you]?.total).toBe(22)
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
