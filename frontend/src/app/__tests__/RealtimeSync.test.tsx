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

  // 서버에 sys.reconnect 라우팅이 없어(티켓 25) 재접속도 room.join으로 복귀해야 한다.
  // sys.reconnect를 보내면 조용히 버려져 "연결됨인데 방에 없는" limbo가 된다.
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
      serverMessage('round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 1,
        turnOrder: [creatorPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('score.update', {
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
      serverMessage('round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 1,
        turnOrder: [creatorPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('score.update', {
        playerId: participantPlayer.playerId,
        scoreboard: { ...createEmptyScoreBoard(), total: 24 },
      }),
    )
    // 서버 스냅샷에는 game이 없다. 갈아끼우면 상대 점수판까지 사라진다.
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

  /**
   * game.over 핸들러가 없으면 서버가 종료를 알려도 화면이 게임에 머문다(QA 9번의 클라 쪽 절반).
   * 순위는 서버 확정값을 그대로 저장해 결과 화면이 로컬 재계산에 의존하지 않게 한다.
   */
  it('switches the room to finished and stores server rankings on game.over', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(
      serverMessage('round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 12,
        turnOrder: [creatorPlayer.playerId, participantPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('game.over', {
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
      serverMessage('round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 12,
        turnOrder: [creatorPlayer.playerId, participantPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('game.over', {
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

  /** 대기실 복귀는 phase=waiting 스냅샷으로 전달된다 — 지난 게임 진행 상태는 함께 버려야 한다. */
  it('drops game state when the room goes back to the lobby', () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )

    client.emitMessage(
      serverMessage('round.start', {
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

  /**
   * 유예가 끝나 서버가 방을 닫은 뒤의 "이어서 하기". 세션을 정리하지 않으면 복귀 배너가
   * 계속 뜨고, 누를 때마다 같은 실패를 반복한다(S15P11A406-136).
   */
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

  // 되돌릴 수 있는 실패로 세션을 버리면 사용자는 이유 없이 방에서 쫓겨난다.
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

  // 로컬 세션이 사라진 직후 도착한 늦은 room.joined도 죽지 않고 방 스냅샷을 그대로 반영해야 한다.
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
      serverMessage('round.start', {
        activePlayerId: creatorPlayer.playerId,
        deadline: 2_000,
        roundNumber: 1,
        turnOrder: [creatorPlayer.playerId],
      }),
    )
    client.emitMessage(
      serverMessage('dice.broadcast', {
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

    // 지난 라운드의 뒤늦은 broadcast는 이미 넘어간 턴을 덮어써서는 안 된다.
    client.emitMessage(
      serverMessage('dice.broadcast', {
        playerId: creatorPlayer.playerId,
        roundNumber: 0,
        rollCount: 3,
        dice: [6, 6, 6, 6, 6],
        held: [false, false, false, false, false],
      }),
    )

    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({ rollCount: 2 })

    client.emitMessage(
      serverMessage('dice.broadcast', {
        playerId: participantPlayer.playerId,
        roundNumber: 1,
        rollCount: 3,
        dice: [6, 6, 6, 6, 6],
        held: [false, false, false, false, false],
      }),
    )
    expect(useAppStore.getState().roomSnapshot?.game).toMatchObject({ rollCount: 2 })

    client.emitMessage(
      serverMessage('dice.broadcast', {
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
        'dice.broadcast',
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

  // 40분 유예가 끝나 이미 정리된 자리로 재접속을 시도하면 서버가 이 코드로 거절한다.
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

    client.emitMessage(serverMessage('round.end', { roundNumber: 1, submitted: [] }))
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
    // 재접속으로 다시 들어온 참가자는 뒤로 붙어도 명단에 반드시 남아야 한다.
    expect(players.at(-1)).toMatchObject({ playerId: participantPlayer.playerId })
  })

  describe('연결 유지', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    // 서버는 heartbeat이 끊기면 나간 것으로 처리한다 — ping이 멈추면 게임 중 강제 퇴장이다.
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
