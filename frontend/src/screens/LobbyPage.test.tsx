import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { creatorSession } from '@/mocks/fixtures'
import { useAppStore } from '@/store'
import { LobbyPage } from './LobbyPage'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

describe('LobbyPage', () => {
  beforeEach(() => {
    navigate.mockReset()
    useAppStore.getState().reset()
    useAppStore.getState().setRoomSession(creatorSession)
    useAppStore.getState().setConnectionStatus('connected')
  })

  it('shows every participant and marks the current player', () => {
    render(<LobbyPage roomId={creatorSession.roomId} />)

    expect(screen.getByRole('region', { name: '참가자 2명' })).toBeVisible()
    expect(screen.getByText('느긋한 주사위')).toBeVisible()
    expect(screen.getByText('참가자')).toBeVisible()
    expect(screen.getByText('나')).toBeVisible()
  })

  it('lets any participant start once two players are present', async () => {
    const user = userEvent.setup()
    render(<LobbyPage roomId={creatorSession.roomId} />)

    await user.click(screen.getByRole('button', { name: '게임 시작' }))

    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(useAppStore.getState().roomSnapshot?.phase).toBe('playing')
    expect(navigate).toHaveBeenCalledWith({
      to: '/rooms/$roomId/game',
      params: { roomId: creatorSession.roomId },
      replace: true,
    })
  })

  it('keeps link-copy fallback available next to the QR code', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<LobbyPage roomId={creatorSession.roomId} />)
    await user.click(screen.getByRole('button', { name: '링크 복사' }))

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join?code=${creatorSession.roomCode}`,
    )
    expect(screen.getByText('초대 링크를 복사했어요.')).toBeVisible()
  })

  it('moves once when realtime changes the room phase', async () => {
    render(<LobbyPage roomId={creatorSession.roomId} />)

    useAppStore.getState().replaceRoomSnapshot({
      ...creatorSession.snapshot,
      phase: 'playing',
    })

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/rooms/$roomId/game',
        params: { roomId: creatorSession.roomId },
        replace: true,
      }),
    )
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})
