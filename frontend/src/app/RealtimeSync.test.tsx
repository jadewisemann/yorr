import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createEmptyScoreBoard,
  creatorPlayer,
  creatorSession,
  participantPlayer,
  serverMessage,
} from '@/mocks/fixtures'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import { useAppStore } from '@/store'
import { RealtimeSync } from './RealtimeSync'

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

  it('keeps the session token and waits for an explicit retry after repeated failures', async () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )
    await waitFor(() => expect(useAppStore.getState().connectionStatus).toBe('connected'))

    for (let attempt = 0; attempt < 11; attempt += 1) client.emitConnection('close')

    expect(useAppStore.getState().roomSession?.sessionToken).toBe(creatorSession.sessionToken)
    expect(useAppStore.getState().roomResumeReason).toBe('disconnected')
    expect(localStorage.getItem('yorr.room-session')).toContain(creatorSession.sessionToken)
    expect(useAppStore.getState().appNotice).toContain('다시 연결')
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
})
