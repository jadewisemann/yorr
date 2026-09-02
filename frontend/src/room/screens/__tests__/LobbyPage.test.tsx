import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  creatorPlayer,
  creatorSession,
  participantPlayer,
  participantSession,
  waitingRoomSnapshot,
} from '@/mocks/fixtures'
import { clearMockRoomSnapshot } from '@/mocks/mockRoomState'
import { savePartyRoom } from '@/room/partyControllerStorage'
import { LobbyPage } from '@/room/screens/LobbyPage'
import { useAppStore } from '@/store'
import { navigateSpy } from '@/test/routerDouble'

const { prefetchPhysicsDiceWorld } = vi.hoisted(() => ({ prefetchPhysicsDiceWorld: vi.fn() }))

vi.mock('@/yacht/rendering/physics-dice/loadWorld', () => ({ prefetchPhysicsDiceWorld }))

vi.mock('@tanstack/react-router', async () =>
  (await import('@/test/routerDouble')).routerWithNavigateSpy(),
)

/**
 * `matches`만 있는 반쪽 스텁으로는 `useMediaQuery`가 change 리스너를 달다가 깨진다 —
 * 대기실 화면도 미디어 질의를 구독하므로(채팅 창 레이아웃) 리스너 두 개를 함께 준다.
 */
function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  )
}

type User = ReturnType<typeof userEvent.setup>

/** 방을 벗어나려다 뜬 확인 창에서 버튼 하나를 누른다. */
async function answerExitPrompt(user: User, name: string) {
  await user.click(screen.getByRole('button', { name: '나가기' }))
  const dialog = await screen.findByRole('alertdialog', { name: '방에서 나갈까요?' })
  await user.click(within(dialog).getByRole('button', { name }))
}

/** 방장이 게임을 시작해 판이 열릴 때까지. */
async function startGame(user: User) {
  await user.click(screen.getByRole('button', { name: '게임 시작' }))

  await waitFor(() => expect(navigateSpy).toHaveBeenCalled())
  expect(useAppStore.getState().roomSnapshot?.phase).toBe('playing')
}

describe('LobbyPage', () => {
  beforeEach(() => {
    navigateSpy.mockReset()
    clearMockRoomSnapshot()
    prefetchPhysicsDiceWorld.mockReset()
    clearMockRoomSnapshot()
    stubMatchMedia(false)
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: IdleRequestCallback) => {
        callback({ didTimeout: false, timeRemaining: () => 50 })
        return 1
      }),
    )
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    localStorage.clear()
    useAppStore.getState().reset()
    useAppStore.getState().setRoomSession(creatorSession)
    useAppStore.getState().setConnectionStatus('connected')
  })

  it('파티 컨트롤러에게는 초대 입구 대신 연결 안내를 보여준다', () => {
    savePartyRoom(creatorSession.roomCode)

    render(<LobbyPage roomId={creatorSession.roomId} />)

    expect(screen.getByRole('region', { name: '컨트롤러 연결' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '초대' })).not.toBeInTheDocument()
  })

  it('일반 방에서는 초대 버튼을 그대로 둔다', () => {
    render(<LobbyPage roomId={creatorSession.roomId} />)

    expect(screen.getByRole('button', { name: '초대' })).toBeVisible()
    expect(screen.queryByRole('region', { name: '컨트롤러 연결' })).not.toBeInTheDocument()
  })

  it('첫 화면을 그린 뒤 물리 주사위 모듈을 유휴 시간에 미리 불러온다', async () => {
    render(<LobbyPage roomId={creatorSession.roomId} />)

    expect(requestIdleCallback).toHaveBeenCalledOnce()
    await waitFor(() => expect(prefetchPhysicsDiceWorld).toHaveBeenCalledOnce())
  })

  it('모션 감소 설정에서는 물리 주사위 모듈을 미리 받지 않는다', () => {
    stubMatchMedia(true)

    render(<LobbyPage roomId={creatorSession.roomId} />)

    expect(requestIdleCallback).not.toHaveBeenCalled()
    expect(prefetchPhysicsDiceWorld).not.toHaveBeenCalled()
  })

  it('shows every participant and marks the current player', () => {
    render(<LobbyPage roomId={creatorSession.roomId} />)

    expect(screen.getByRole('region', { name: '참가자 2명' })).toBeVisible()
    expect(screen.getByText('느긋한 주사위')).toBeVisible()
    expect(screen.getByText('참가자')).toBeVisible()
    expect(screen.getByText('나')).toBeVisible()
  })

  it('shows an explicit badge when a participant is offline', () => {
    useAppStore.getState().replaceRoomSnapshot({
      ...waitingRoomSnapshot,
      players: [creatorPlayer, { ...participantPlayer, status: 'offline' }],
    })

    render(<LobbyPage roomId={creatorSession.roomId} />)

    expect(screen.getByText('연결 끊김')).toBeVisible()
  })

  it('lets the host start the game', async () => {
    const user = userEvent.setup()
    render(<LobbyPage roomId={creatorSession.roomId} />)

    await startGame(user)

    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/rooms/$roomId/game',
      params: { roomId: creatorSession.roomId },
      replace: true,
    })
  })

  it('lets the host start alone', async () => {
    const user = userEvent.setup()
    useAppStore.getState().replaceRoomSnapshot({ ...waitingRoomSnapshot, players: [creatorPlayer] })

    render(<LobbyPage roomId={creatorSession.roomId} />)

    expect(screen.getByRole('button', { name: '게임 시작' })).toBeEnabled()

    await startGame(user)
  })

  it('keeps a participant waiting for the host', () => {
    useAppStore.getState().setRoomSession(participantSession)

    render(<LobbyPage roomId={participantSession.roomId} />)

    expect(screen.getByRole('button', { name: '게임 시작 · 호스트 전용' })).toBeDisabled()
    expect(screen.getByText('호스트가 게임을 시작하면 자동으로 이동해요.')).toBeVisible()
  })

  it('lets the host add and remove a bot', async () => {
    const user = userEvent.setup()
    render(<LobbyPage roomId={creatorSession.roomId} />)

    await user.click(screen.getByRole('button', { name: '봇 추가' }))
    expect(await screen.findByText('상태 기반 AI 봇')).toBeVisible()
    expect(screen.getByRole('region', { name: '참가자 3명' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(screen.getByRole('region', { name: '참가자 2명' })).toBeVisible())
  })

  it('does not show bot controls to a participant', () => {
    useAppStore.getState().setRoomSession(participantSession)

    render(<LobbyPage roomId={participantSession.roomId} />)

    expect(screen.queryByRole('region', { name: 'AI 봇 관리' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '봇 추가' })).not.toBeInTheDocument()
  })

  it('초대 팝업을 열기 전에는 QR과 방 코드를 화면에 두지 않는다', async () => {
    const user = userEvent.setup()
    render(<LobbyPage roomId={creatorSession.roomId} />)

    expect(screen.queryByRole('img', { name: /초대 QR 코드/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '링크 복사' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '초대' }))

    const popover = await screen.findByRole('dialog', { name: '친구 초대하기' })
    expect(within(popover).getByRole('img', { name: /초대 QR 코드/ })).toBeInTheDocument()
    expect(within(popover).getByText(creatorSession.roomCode)).toBeVisible()
  })

  it('keeps link-copy fallback available next to the QR code', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<LobbyPage roomId={creatorSession.roomId} />)
    await user.click(screen.getByRole('button', { name: '초대' }))
    await user.click(await screen.findByRole('button', { name: '링크 복사' }))

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/join?code=${creatorSession.roomCode}`,
    )
    expect(screen.getByText('초대 링크를 복사했어요.')).toBeVisible()
  })

  it('연결이 아직 붙지 않았으면 상태를 라벨로 알리고 시작을 막는다', () => {
    useAppStore.getState().setConnectionStatus('reconnecting')
    const { unmount } = render(<LobbyPage roomId={creatorSession.roomId} />)

    expect(screen.getByText('재연결 중')).toBeVisible()
    expect(screen.getByRole('button', { name: '게임 시작' })).toBeDisabled()
    expect(screen.getByText('연결된 뒤 게임을 시작할 수 있어요.')).toBeVisible()
    unmount()

    useAppStore.getState().setConnectionStatus('closed')
    const closed = render(<LobbyPage roomId={creatorSession.roomId} />)
    expect(closed.getByText('연결 종료')).toBeVisible()
    closed.unmount()

    useAppStore.getState().setConnectionStatus('connecting')
    render(<LobbyPage roomId={creatorSession.roomId} />)
    expect(screen.getByText('연결 중')).toBeVisible()
  })

  it('나가기는 확인을 받고, 머무르기를 고르면 방에 남는다', async () => {
    const user = userEvent.setup()
    render(<LobbyPage roomId={creatorSession.roomId} />)

    await answerExitPrompt(user, '머무르기')

    expect(screen.queryByRole('alertdialog', { name: '방에서 나갈까요?' })).not.toBeInTheDocument()
    expect(useAppStore.getState().roomSession).not.toBeNull()
  })

  it('나가기를 확정하면 세션을 정리하고 홈으로 보낸다', async () => {
    const user = userEvent.setup()
    render(<LobbyPage roomId={creatorSession.roomId} />)

    await answerExitPrompt(user, '나가기')

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/', replace: true })
    expect(sessionStorage.getItem('yorr.room-session')).toBeNull()
  })

  it('moves once when realtime changes the room phase', async () => {
    render(<LobbyPage roomId={creatorSession.roomId} />)

    useAppStore.getState().replaceRoomSnapshot({
      ...creatorSession.snapshot,
      phase: 'playing',
    })

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: '/rooms/$roomId/game',
        params: { roomId: creatorSession.roomId },
        replace: true,
      }),
    )
    expect(navigateSpy).toHaveBeenCalledTimes(1)
  })
})
