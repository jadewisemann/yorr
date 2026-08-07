import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeSync } from '@/app/RealtimeSync'
import {
  createEmptyScoreBoard,
  creatorPlayer,
  creatorSession,
  participantPlayer,
  serverMessage,
} from '@/mocks/fixtures'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { useAppStore } from '@/store'

describe('RealtimeSync', () => {
  beforeEach(() => {
    useAppStore.getState().reset()
    useAppStore.getState().setRoomSession(creatorSession)
  })

  it('attaches the REST session and applies a server snapshot', async () => {
    const client = createRealtimeFixture({ role: 'creator' })

    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    await waitFor(() => expect(useAppStore.getState().connectionStatus).toBe('connected'))
    expect(client.sentMessages[0]).toMatchObject({
      type: 'room.join',
      payload: {
        roomId: creatorSession.roomId,
        nickname: creatorSession.nickname,
        sessionToken: creatorSession.sessionToken,
      },
    })
  })

  it('keeps the connection pending until the room join is acknowledged', () => {
    const client = new FakeRealtimeClient()

    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    expect(client.sentMessages[0]).toMatchObject({ type: 'room.join' })
    expect(useAppStore.getState().connectionStatus).toBe('connecting')

    client.emitMessage(
      serverMessage(
        'room.joined',
        {
          you: creatorSession.you,
          sessionToken: creatorSession.sessionToken,
          snapshot: creatorSession.snapshot,
        },
        { roomId: creatorSession.roomId },
      ),
    )

    expect(useAppStore.getState().connectionStatus).toBe('connected')
  })

  it('re-sends room.join with the saved session on reconnect', async () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )
    await waitFor(() => expect(useAppStore.getState().connectionStatus).toBe('connected'))
    client.sentMessages.length = 0

    client.emitConnection('close')
    expect(useAppStore.getState().connectionStatus).toBe('reconnecting')
    client.emitConnection('open')

    expect(client.sentMessages[0]).toMatchObject({
      type: 'room.join',
      payload: {
        roomId: creatorSession.roomId,
        nickname: creatorSession.nickname,
        sessionToken: creatorSession.sessionToken,
      },
    })
  })

  it('keeps the session token and waits for an explicit retry after repeated failures', () => {
    vi.useFakeTimers()
    try {
      const client = new FakeRealtimeClient()
      render(
        <RealtimeSync client={client}>
          <div>app</div>
        </RealtimeSync>,
      )

      for (let attempt = 0; attempt < 11; attempt += 1) {
        act(() => client.emitConnection('close'))
        if (attempt < 10) act(() => vi.advanceTimersByTime(1_000))
      }

      expect(useAppStore.getState().roomSession?.sessionToken).toBe(creatorSession.sessionToken)
      expect(useAppStore.getState().roomResumeReason).toBe('disconnected')
      expect(localStorage.getItem('yorr.room-session')).toContain(creatorSession.sessionToken)
      expect(useAppStore.getState().appNotice).toContain('다시 연결')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not auto-join a paused session until the user resumes it', async () => {
    useAppStore.getState().endSession('disconnected')
    const client = createRealtimeFixture({ role: 'creator' })

    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    expect(client.sentMessages).toHaveLength(0)
    expect(useAppStore.getState().connectionStatus).toBe('closed')

    useAppStore.getState().resumeRoomSession()

    await waitFor(() => expect(useAppStore.getState().connectionStatus).toBe('connected'))
    expect(client.sentMessages[0]).toMatchObject({
      type: 'room.join',
      payload: { sessionToken: creatorSession.sessionToken },
    })
  })

  it('updates presence and roster from realtime events', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(
      serverMessage('presence.update', {
        playerId: creatorPlayer.playerId,
        status: 'away',
      }),
    )
    expect(useAppStore.getState().roomSnapshot?.players[0]?.status).toBe('away')

    client.emitMessage(serverMessage('room.player_left', { playerId: creatorPlayer.playerId }))
    expect(useAppStore.getState().roomSnapshot?.players).not.toContainEqual(creatorPlayer)
  })

  it('applies the active turn and broadcasts a confirmed score to the shared snapshot', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(
      serverMessage('game.yacht_dice.round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 1,
        turnOrder: [creatorPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('game.yacht_dice.score.update', {
        playerId: participantPlayer.playerId,
        scoreboard: { ...createEmptyScoreBoard(), total: 24 },
      }),
    )

    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({
      activePlayerId: creatorPlayer.playerId,
      roundDeadline: 2_000,
      roundNumber: 1,
      scores: {
        [participantPlayer.playerId]: { total: 24 },
      },
    })
  })

  it('keeps every player scoreboard when the server resends a snapshot without game state', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(
      serverMessage('game.yacht_dice.round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 1,
        turnOrder: [creatorPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('game.yacht_dice.score.update', {
        playerId: participantPlayer.playerId,
        scoreboard: { ...createEmptyScoreBoard(), total: 24 },
      }),
    )
    client.emitMessage(
      serverMessage('state.sync', {
        snapshot: {
          roomId: creatorSession.roomId,
          phase: 'playing',
          players: [creatorPlayer, participantPlayer],
        },
      }),
    )

    expect(useAppStore.getState().roomSnapshot?.game?.scores).toMatchObject({
      [participantPlayer.playerId]: { total: 24 },
    })
  })

  it('switches the room to finished and stores server rankings on game.over', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(
      serverMessage('game.yacht_dice.round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 12,
        turnOrder: [creatorPlayer.playerId, participantPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('game.yacht_dice.game.over', {
        rankings: [
          { rank: 1, playerId: participantPlayer.playerId, total: 205 },
          { rank: 2, playerId: creatorPlayer.playerId, total: 180 },
        ],
      }),
    )

    const snapshot = useAppStore.getState().roomSnapshot
    expect(snapshot?.phase).toBe('finished')
    expect(snapshot?.game?.rankings).toEqual([
      { rank: 1, playerId: participantPlayer.playerId, total: 205 },
      { rank: 2, playerId: creatorPlayer.playerId, total: 180 },
    ])
  })

  it('keeps result nicknames when a player leaves after game over', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(
      serverMessage('game.yacht_dice.round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 12,
        turnOrder: [creatorPlayer.playerId, participantPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('game.yacht_dice.game.over', {
        rankings: [
          { rank: 1, playerId: participantPlayer.playerId, total: 205 },
          { rank: 2, playerId: creatorPlayer.playerId, total: 180 },
        ],
      }),
    )

    client.emitMessage(serverMessage('room.player_left', { playerId: participantPlayer.playerId }))
    client.emitMessage(
      serverMessage('state.sync', {
        snapshot: {
          roomId: creatorSession.roomId,
          phase: 'finished',
          players: [creatorPlayer],
        },
      }),
    )

    expect(useAppStore.getState().roomSnapshot?.players).toContainEqual(participantPlayer)
  })

  it('drops game state when the room goes back to the lobby', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(
      serverMessage('game.yacht_dice.round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 12,
        turnOrder: [creatorPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('state.sync', {
        snapshot: {
          roomId: creatorSession.roomId,
          phase: 'waiting',
          players: [creatorPlayer, participantPlayer],
        },
      }),
    )

    expect(useAppStore.getState().roomSnapshot?.phase).toBe('waiting')
    expect(useAppStore.getState().roomSnapshot?.game).toBeUndefined()
  })

  it('clears a closed or expired room instead of reconnecting forever', async () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(serverMessage('room.closed', { reason: 'server_shutdown' }))

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
    expect(useAppStore.getState().appNotice).toContain('방이 종료')
  })

  it('clears a saved token when the server rejects it as expired', async () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(
      serverMessage('error', { code: 'SESSION_EXPIRED', message: 'session expired' }),
    )

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
    expect(localStorage.getItem('yorr.room-session')).toBeNull()
  })

  it('clears the session when the server says the room is gone', async () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(serverMessage('error', { code: 'ROOM_NOT_FOUND', message: 'room closed' }))

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
    expect(useAppStore.getState().appNotice).toContain('방이 종료')
    expect(localStorage.getItem('yorr.room-session')).toBeNull()
  })

  it('인증이 깨진 세션도 붙잡지 않고 즉시 정리한다', async () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(serverMessage('error', { code: 'AUTH_FAILED', message: 'auth failed' }))

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
  })

  it('되돌릴 수 있는 오류로는 세션을 버리지 않는다', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(serverMessage('error', { code: 'RATE_LIMITED', message: 'slow down' }))

    expect(useAppStore.getState().roomSession?.sessionToken).toBe(creatorSession.sessionToken)
  })

  it('로컬 세션이 없는 상태로 도착한 room.joined는 스냅샷만 갈아끼운다', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )
    useAppStore.setState({ roomSession: null })

    client.emitMessage(
      serverMessage('room.joined', {
        you: participantPlayer.playerId,
        sessionToken: 'late-token',
        snapshot: { roomId: creatorSession.roomId, phase: 'waiting', players: [creatorPlayer] },
      }),
    )

    expect(useAppStore.getState().roomSession).toBeNull()
    expect(useAppStore.getState().roomSnapshot).toMatchObject({ phase: 'waiting' })
  })

  it('진행 중인 턴과 같은 라운드의 주사위 결과만 공유 스냅샷에 반영한다', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(
      serverMessage('game.yacht_dice.round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 1,
        turnOrder: [creatorPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('game.yacht_dice.dice.broadcast', {
        playerId: creatorPlayer.playerId,
        roundNumber: 1,
        rollCount: 2,
        dice: [1, 2, 3, 4, 5],
        held: [true, false, false, false, false],
      }),
    )

    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({
      rollCount: 2,
      dice: [1, 2, 3, 4, 5],
      held: [true, false, false, false, false],
    })

    client.emitMessage(
      serverMessage('game.yacht_dice.dice.broadcast', {
        playerId: creatorPlayer.playerId,
        roundNumber: 0,
        rollCount: 3,
        dice: [6, 6, 6, 6, 6],
        held: [false, false, false, false, false],
      }),
    )

    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({ rollCount: 2 })

    client.emitMessage(
      serverMessage('game.yacht_dice.dice.broadcast', {
        playerId: participantPlayer.playerId,
        roundNumber: 1,
        rollCount: 3,
        dice: [6, 6, 6, 6, 6],
        held: [false, false, false, false, false],
      }),
    )
    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({ rollCount: 2 })

    client.emitMessage(
      serverMessage('game.yacht_dice.dice.broadcast', {
        playerId: creatorPlayer.playerId,
        roundNumber: 1,
        rollCount: 1,
        dice: [6, 6, 6, 6, 6],
        held: [false, false, false, false, false],
      }),
    )
    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({ rollCount: 2 })

    client.emitMessage(
      serverMessage(
        'game.yacht_dice.dice.broadcast',
        {
          playerId: creatorPlayer.playerId,
          roundNumber: 1,
          rollCount: 3,
          dice: [6, 6, 6, 6, 6],
          held: [false, false, false, false, false],
        },
        { roomId: 'another-room' },
      ),
    )
    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({ rollCount: 2 })
  })

  it('유예가 끝난 자리로의 재접속은 세션을 정리한다', async () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(
      serverMessage('error', { code: 'GAME_ALREADY_STARTED', message: 'seat reclaimed' }),
    )

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
    expect(useAppStore.getState().appNotice).toContain('게임에서 나가게')
  })

  it('알 수 없는 메시지 타입은 방 상태를 건드리지 않고 지나간다', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )
    const before = useAppStore.getState().roomSnapshot

    client.emitMessage(
      serverMessage('game.yacht_dice.round.end', { roundNumber: 1, submitted: [] }),
    )
    client.emitMessage(serverMessage('sys.pong', { serverTs: 1 }))

    expect(useAppStore.getState().roomSnapshot).toBe(before)
  })

  it('새 참가자를 명단에 더하고 같은 참가자가 다시 와도 중복으로 쌓지 않는다', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(serverMessage('room.player_joined', { player: participantPlayer }))
    client.emitMessage(serverMessage('room.player_joined', { player: participantPlayer }))

    const players = useAppStore.getState().roomSnapshot?.players ?? []
    expect(players.filter((player) => player.playerId === participantPlayer.playerId)).toHaveLength(
      1,
    )
    expect(players.at(-1)).toMatchObject({ playerId: participantPlayer.playerId })
  })

  describe('연결 유지', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('서버가 알려준 주기로 heartbeat을 계속 보낸다', () => {
      const client = createRealtimeFixture({ role: 'creator' })
      render(
        <RealtimeSync client={client}>
          <div>app</div>
        </RealtimeSync>,
      )

      act(() => vi.advanceTimersByTime(30_000))

      expect(client.sentMessages.filter((message) => message.type === 'sys.ping')).toHaveLength(2)
    })

    it('heartbeat 전송이 실패해도 앱을 멈추지 않는다', () => {
      const client = createRealtimeFixture({ role: 'creator' })
      render(
        <RealtimeSync client={client}>
          <div>app</div>
        </RealtimeSync>,
      )
      vi.spyOn(client, 'send').mockImplementation(() => {
        throw new Error('socket is closed')
      })

      expect(() => act(() => vi.advanceTimersByTime(15_000))).not.toThrow()
      expect(useAppStore.getState().roomSession).not.toBeNull()
    })

    it('연결이 끊기면 잠시 뒤 스스로 다시 붙고 방에 다시 참가한다', () => {
      const client = createRealtimeFixture({ role: 'creator' })
      render(
        <RealtimeSync client={client}>
          <div>app</div>
        </RealtimeSync>,
      )
      client.sentMessages.length = 0

      act(() => client.emitConnection('close'))
      expect(useAppStore.getState().connectionStatus).toBe('reconnecting')

      act(() => vi.advanceTimersByTime(1_000))

      expect(useAppStore.getState().connectionStatus).toBe('connected')
      expect(client.sentMessages[0]).toMatchObject({
        type: 'room.join',
        payload: { sessionToken: creatorSession.sessionToken },
      })
    })

    it('재연결 대기 중 중복 close가 와도 연결 예약을 하나만 유지한다', () => {
      const client = createRealtimeFixture({ role: 'creator' })
      render(
        <RealtimeSync client={client}>
          <div>app</div>
        </RealtimeSync>,
      )
      client.sentMessages.length = 0

      act(() => {
        client.emitConnection('close')
        client.emitConnection('close')
        vi.advanceTimersByTime(1_000)
      })

      expect(client.sentMessages.filter((message) => message.type === 'room.join')).toHaveLength(1)
    })
  })
})
