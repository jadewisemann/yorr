import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { creatorPlayer, creatorSession, serverMessage } from '@/mocks/fixtures'
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
})
