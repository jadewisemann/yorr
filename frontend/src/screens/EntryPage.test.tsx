import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { creatorSession } from '@/mocks/fixtures'
import { useAppStore } from '@/store'
import { EntryPage } from './EntryPage'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

/** jsdom은 미디어 쿼리를 평가하지 않는다. 어느 레이아웃을 검증할지 테스트가 직접 정한다. */
function useLayout(wide: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: wide,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  })
}

/** 코드 입력은 팝오버·바텀시트 안에 있다 — 배경에 같은 이름의 버튼이 있으므로 항상 좁혀 찾는다. */
function codeDialog() {
  return within(screen.getByRole('dialog', { name: '초대받은 방에 참가' }))
}

describe('EntryPage', () => {
  beforeEach(() => {
    navigate.mockReset()
    useAppStore.getState().reset()
    useLayout(false)
  })
  afterEach(() => vi.restoreAllMocks())

  it('opens on the released game with its play call to action', () => {
    render(<EntryPage />)

    expect(screen.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
    expect(screen.getByText('PLAYABLE NOW')).toBeVisible()
    expect(screen.getByRole('button', { name: '요트 다이스 플레이' })).toBeVisible()
  })

  it('opens nickname entry for a new room', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '요트 다이스 플레이' }))

    expect(navigate).toHaveBeenCalledWith({ to: '/join', search: { code: undefined } })
  })

  it('locks the call to action for a game that has not shipped', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('tab', { name: /라이어스 다이스/ }))

    expect(screen.getByRole('heading', { name: '라이어스 다이스' })).toBeVisible()
    expect(screen.getByText('COMING SOON')).toBeVisible()
    expect(screen.queryByRole('button', { name: /플레이$/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '준비 중인 게임' })).toBeDisabled()
  })

  it('wraps around the carousel tablist with the arrow keys and keeps focus on the selection', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    const firstTab = screen.getByRole('tab', { name: /요트 다이스/ })
    firstTab.focus()
    await user.keyboard('{ArrowLeft}')

    const lastTab = screen.getByRole('tab', { name: /낚시/ })
    expect(lastTab).toHaveFocus()
    expect(lastTab).toHaveAttribute('aria-selected', 'true')
    expect(lastTab).toHaveAttribute('tabindex', '0')
    expect(firstTab).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('heading', { name: '낚시' })).toBeVisible()
  })

  it('steps through the carousel with the arrow buttons on the wide layout', async () => {
    useLayout(true)
    const user = userEvent.setup()
    render(<EntryPage />)

    // 첫 게임에서는 되돌아갈 곳이 없다 — 감싸지 않고 막는다(점 목록의 방향키만 감싼다).
    expect(screen.getByRole('button', { name: '이전 게임' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '다음 게임' }))

    expect(screen.getByRole('heading', { name: '라이어스 다이스' })).toBeVisible()
    expect(screen.getByRole('tab', { name: /라이어스 다이스/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('button', { name: '이전 게임' })).toBeEnabled()
  })

  it('sanitizes the room code in the code dialog and only enables join once it is valid', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '코드로 참가' }))
    const dialog = codeDialog()
    const input = dialog.getByRole('textbox', { name: '방 코드' })
    expect(dialog.getByRole('button', { name: '코드로 참가' })).toBeDisabled()

    await user.type(input, 'yo!r')
    expect(input).toHaveValue('YOR')
    expect(dialog.getByRole('button', { name: '코드로 참가' })).toBeDisabled()

    await user.type(input, 'r64')
    expect(input).toHaveValue('YORR64')

    await user.click(dialog.getByRole('button', { name: '코드로 참가' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/join', search: { code: 'YORR64' } })
  })

  it('closes the code dialog again without joining', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '코드로 참가' }))
    await user.click(codeDialog().getByRole('button', { name: '코드 입력 닫기' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('asks before reconnecting a preserved room session', async () => {
    const user = userEvent.setup()
    useAppStore.getState().setRoomSession(creatorSession)
    useAppStore.getState().endSession('disconnected')

    render(<EntryPage />)

    const recovery = screen.getByRole('region', { name: '진행 중인 방' })
    expect(within(recovery).getByText('진행 중인 게임이 있어요')).toBeVisible()
    expect(within(recovery).getByRole('button', { name: '다시 연결' })).toBeVisible()

    await user.click(within(recovery).getByRole('button', { name: '다시 연결' }))

    expect(useAppStore.getState().roomResumeReason).toBeNull()
    expect(navigate).toHaveBeenCalledWith({
      to: '/rooms/$roomId/lobby',
      params: { roomId: creatorSession.roomId },
    })
  })

  it('explicitly leaves a preserved room and clears its token', async () => {
    const user = userEvent.setup()
    useAppStore.getState().setRoomSession(creatorSession)
    useAppStore.getState().endSession('disconnected')

    render(<EntryPage />)
    await user.click(screen.getByRole('button', { name: '나가기' }))

    await waitFor(() => expect(useAppStore.getState().roomSession).toBeNull())
    expect(localStorage.getItem('yorr.room-session')).toBeNull()
  })
})
