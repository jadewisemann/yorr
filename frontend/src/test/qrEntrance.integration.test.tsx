import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gameApiClient } from '@/api/gameApi'
import { creatorSession, serverMessage } from '@/mocks/fixtures'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { useAppStore } from '@/store'
import { installUserAgentMock, mockApiError, renderAppHarness, resetAppTestState } from './harness'

describe('QR entrance integration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetAppTestState()
  })

  it('joins through a normalized invite link and reaches a realtime lobby', async () => {
    const { realtimeClient, user } = renderAppHarness({
      initialPath: '/join?code=yorr64',
    })

    await user.type(await screen.findByRole('textbox', { name: '닉네임' }), 'QR 참가자')
    await user.click(screen.getByRole('button', { name: '대기실 입장' }))

    expect(await screen.findByRole('heading', { name: '대기실' })).toBeVisible()
    expect(screen.getByRole('img', { name: '방 YORR64 초대 QR 코드' })).toBeVisible()
    expect(useAppStore.getState().roomSession?.roomCode).toBe('YORR64')
    await waitFor(() =>
      expect(realtimeClient.sentMessages[0]).toMatchObject({
        type: 'room.join',
        payload: {
          roomId: 'YORR64',
          nickname: 'QR 참가자',
          sessionToken: useAppStore.getState().roomSession?.sessionToken,
        },
      }),
    )
  })

  it('blocks an invalid invite before REST and accepts a corrected code', async () => {
    const joinRoom = vi.spyOn(gameApiClient, 'joinRoom')
    const { user } = renderAppHarness({ initialPath: '/join?code=bad!' })

    expect(await screen.findByRole('heading', { name: '초대 코드를 확인해 주세요' })).toBeVisible()
    expect(joinRoom).not.toHaveBeenCalled()

    const codeInput = screen.getByRole('textbox', { name: '초대 코드' })
    await user.clear(codeInput)
    await user.type(codeInput, ' yorr64 ')
    await user.click(screen.getByRole('button', { name: '수정한 코드로 참가' }))

    // 코드 칩이 "초대 코드"와 코드를 나눠 그리므로 두 조각을 각각 확인한다.
    expect(await screen.findByText('초대 코드')).toBeVisible()
    expect(screen.getAllByText('YORR64').length).toBeGreaterThan(0)
    expect(joinRoom).not.toHaveBeenCalled()
  })

  it('keeps the nickname after a room error and prevents duplicate submissions', async () => {
    // 두 번째 클릭이 "첫 요청이 진행 중"인 동안 도달하도록 응답을 보류해 타이밍을 고정한다.
    let respondWithRoomFull!: () => void
    mockApiError({
      code: 'ROOM_FULL',
      path: '/api/v1/rooms',
      status: 409,
      until: new Promise<void>((resolve) => {
        respondWithRoomFull = resolve
      }),
    })
    const joinRoom = vi.spyOn(gameApiClient, 'joinRoom')
    const { user } = renderAppHarness({ initialPath: '/join?code=YORR64' })
    const nicknameInput = await screen.findByRole('textbox', { name: '닉네임' })

    await user.type(nicknameInput, '가득찬 방')
    const submit = screen.getByRole('button', { name: '대기실 입장' })
    await Promise.all([user.click(submit), user.click(submit)])
    expect(joinRoom).toHaveBeenCalledTimes(1)
    respondWithRoomFull()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '방이 가득 찼어요. 다른 초대 코드로 참가해 주세요.',
    )
    expect(nicknameInput).toHaveValue('가득찬 방')
    expect(joinRoom).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().roomSession).toBeNull()
  })

  it('copies and shares the canonical invitation from the lobby', async () => {
    const { browserApis, user } = renderAppHarness({
      browserApis: true,
      initialPath: `/rooms/${creatorSession.roomId}/lobby`,
      session: creatorSession,
    })

    try {
      const inviteUrl = `${window.location.origin}/join?code=${creatorSession.roomCode}`

      await user.click(await screen.findByRole('button', { name: '링크 복사' }))
      await user.click(screen.getByRole('button', { name: '공유하기' }))

      expect(browserApis?.writeText).toHaveBeenCalledWith(inviteUrl)
      expect(browserApis?.share).toHaveBeenCalledWith(
        expect.objectContaining({
          url: inviteUrl,
        }),
      )
      expect(screen.getByText('초대 링크를 복사했어요.')).toBeVisible()
    } finally {
      browserApis?.restore()
    }
  })

  it('does not display a stored room under a mismatched room URL', async () => {
    const { router } = renderAppHarness({
      initialPath: '/rooms/different-room/lobby',
      session: creatorSession,
    })

    // 홈으로 강제 리다이렉트하던 시절과 달리, 이제 홈에서 복귀 배너로 선택을 받는다.
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(screen.queryByText('방 different-room')).not.toBeInTheDocument()
    expect(
      await screen.findByText(
        (_, element) => element?.textContent === `${creatorSession.roomCode} 방에 참여 중이에요`,
      ),
    ).toBeVisible()
  })

  it('moves to the game when realtime changes the room phase', async () => {
    const realtimeClient = new FakeRealtimeClient()
    const { router } = renderAppHarness({
      initialPath: `/rooms/${creatorSession.roomId}/lobby`,
      realtimeClient,
      session: creatorSession,
    })

    await screen.findByRole('heading', { name: '대기실' })
    act(() => {
      realtimeClient.emitMessage(
        serverMessage('state.sync', {
          snapshot: { ...creatorSession.snapshot, phase: 'playing' },
        }),
      )
      realtimeClient.emitMessage(
        serverMessage('round.start', {
          activePlayerId: creatorSession.you,
          deadline: Date.now() + 30_000,
          roundNumber: 1,
          turnOrder: [creatorSession.you],
        }),
      )
    })

    expect(await screen.findByRole('button', { name: '굴리기' })).toBeVisible()
    expect(router.state.location.pathname).toBe(`/rooms/${creatorSession.roomId}/game`)
  })

  it('clears a closed room and returns to the home notice', async () => {
    const realtimeClient = new FakeRealtimeClient()
    renderAppHarness({
      initialPath: `/rooms/${creatorSession.roomId}/lobby`,
      realtimeClient,
      session: creatorSession,
    })

    await screen.findByRole('heading', { name: '대기실' })
    act(() => {
      realtimeClient.emitMessage(serverMessage('room.closed', { reason: 'server_shutdown' }))
    })

    expect(await screen.findByRole('heading', { name: '요트 다이스' })).toBeVisible()
    expect(screen.getByText('방이 종료되어 홈으로 이동했어요.')).toBeVisible()
    expect(useAppStore.getState().roomSession).toBeNull()
  })

  it('lets an in-app browser user continue without blocking entrance', async () => {
    const userAgent = installUserAgentMock('Mozilla/5.0 KAKAOTALK Android')

    try {
      const { user } = renderAppHarness()

      expect(await screen.findByRole('heading', { name: '외부 브라우저를 권장해요' })).toBeVisible()
      await user.click(screen.getByRole('button', { name: '그냥 진행' }))

      expect(await screen.findByRole('heading', { name: '요트 다이스' })).toBeVisible()
    } finally {
      userAgent.restore()
    }
  })
})
