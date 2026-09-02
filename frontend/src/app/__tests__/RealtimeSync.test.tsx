import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeSync } from '@/app/RealtimeSync'
import { creatorSession, serverMessage } from '@/mocks/fixtures'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { useAppStore } from '@/store'
import { mountSync } from './realtimeSyncHarness'

describe('RealtimeSync — 세션과 연결', () => {
  beforeEach(() => {
    useAppStore.getState().reset()
    useAppStore.getState().setRoomSession(creatorSession)
  })

  it('attaches the REST session and applies a server snapshot', async () => {
    const client = mountSync()

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
    const client = mountSync()
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
    const client = mountSync()

    expect(client.sentMessages).toHaveLength(0)
    expect(useAppStore.getState().connectionStatus).toBe('closed')

    useAppStore.getState().resumeRoomSession()

    await waitFor(() => expect(useAppStore.getState().connectionStatus).toBe('connected'))
    expect(client.sentMessages[0]).toMatchObject({
      type: 'room.join',
      payload: { sessionToken: creatorSession.sessionToken },
    })
  })
  it('clears a closed or expired room instead of reconnecting forever', async () => {
    const client = mountSync()

    client.emitMessage(serverMessage('room.closed', { reason: 'server_shutdown' }))

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
    expect(useAppStore.getState().appNotice).toContain('방이 종료')
  })

  it('clears a saved token when the server rejects it as expired', async () => {
    const client = mountSync()

    client.emitMessage(
      serverMessage('error', { code: 'SESSION_EXPIRED', message: 'session expired' }),
    )

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
    expect(localStorage.getItem('yorr.room-session')).toBeNull()
  })

  it('clears the session when the server says the room is gone', async () => {
    const client = mountSync()

    client.emitMessage(serverMessage('error', { code: 'ROOM_NOT_FOUND', message: 'room closed' }))

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
    expect(useAppStore.getState().appNotice).toContain('방이 종료')
    expect(localStorage.getItem('yorr.room-session')).toBeNull()
  })

  it('인증이 깨진 세션도 붙잡지 않고 즉시 정리한다', async () => {
    const client = mountSync()

    client.emitMessage(serverMessage('error', { code: 'AUTH_FAILED', message: 'auth failed' }))

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
  })

  it('되돌릴 수 있는 오류로는 세션을 버리지 않는다', () => {
    const client = mountSync()

    client.emitMessage(serverMessage('error', { code: 'RATE_LIMITED', message: 'slow down' }))

    expect(useAppStore.getState().roomSession?.sessionToken).toBe(creatorSession.sessionToken)
  })
  it('유예가 끝난 자리로의 재접속은 세션을 정리한다', async () => {
    const client = mountSync()

    client.emitMessage(
      serverMessage('error', { code: 'GAME_ALREADY_STARTED', message: 'seat reclaimed' }),
    )

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
    expect(useAppStore.getState().appNotice).toContain('게임에서 나가게')
  })
  describe('연결 유지', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('서버가 알려준 주기로 heartbeat을 계속 보낸다', () => {
      const client = mountSync()

      act(() => vi.advanceTimersByTime(30_000))

      expect(client.sentMessages.filter((message) => message.type === 'sys.ping')).toHaveLength(2)
    })

    it('heartbeat 전송이 실패해도 앱을 멈추지 않는다', () => {
      const client = mountSync()
      vi.spyOn(client, 'send').mockImplementation(() => {
        throw new Error('socket is closed')
      })

      expect(() => act(() => vi.advanceTimersByTime(15_000))).not.toThrow()
      expect(useAppStore.getState().roomSession).not.toBeNull()
    })

    it('연결이 끊기면 잠시 뒤 스스로 다시 붙고 방에 다시 참가한다', () => {
      const client = mountSync()
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
      const client = mountSync()
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
