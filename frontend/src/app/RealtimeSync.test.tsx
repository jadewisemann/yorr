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

  it('gives up and clears the session after repeated reconnect failures', async () => {
    const client = createRealtimeFixture({ role: 'creator' })
    render(
      <RealtimeSync client={client}>
        <div>app</div>
      </RealtimeSync>,
    )
    await waitFor(() => expect(useAppStore.getState().connectionStatus).toBe('connected'))

    for (let attempt = 0; attempt < 11; attempt += 1) client.emitConnection('close')

    expect(useAppStore.getState().roomSession).toBeNull()
    expect(useAppStore.getState().appNotice).toContain('연결이 계속 끊겨')
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
})
