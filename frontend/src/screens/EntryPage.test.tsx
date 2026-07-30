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

describe('EntryPage', () => {
  beforeEach(() => {
    navigate.mockReset()
    useAppStore.getState().reset()
    useLayout(false)
  })
  afterEach(() => vi.restoreAllMocks())

  it('opens on the released game with room creation and code entry', () => {
    render(<EntryPage />)

    expect(screen.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
    expect(screen.getByText('지금 플레이 가능')).toBeVisible()
    expect(screen.getByRole('button', { name: '방 만들기' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: '방 코드' })).toBeVisible()
    expect(screen.getByRole('button', { name: '참가' })).toBeDisabled()
  })

  it('opens nickname entry for a new room', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '방 만들기' }))

    expect(navigate).toHaveBeenCalledWith({ to: '/join', search: { code: undefined } })
  })

  it('sanitizes the room code and only enables join once it is valid', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)
    const input = screen.getByRole('textbox', { name: '방 코드' })

    await user.type(input, 'yo!r')
    expect(input).toHaveValue('YOR')
    expect(screen.getByRole('button', { name: '참가' })).toBeDisabled()

    await user.type(input, 'r64')
    expect(input).toHaveValue('YORR64')

    await user.click(screen.getByRole('button', { name: '참가' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/join', search: { code: 'YORR64' } })
  })

  it('swaps the hero to an unreleased game and offers launch notification instead', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('tab', { name: /라이어스 다이스/ }))

    expect(screen.getByRole('heading', { name: '라이어스 다이스' })).toBeVisible()
    expect(screen.getByText('준비 중')).toBeVisible()
    expect(screen.queryByRole('button', { name: '방 만들기' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '출시 알림 받기' })).toBeVisible()
  })

  it('wraps around the tablist with the arrow keys and keeps focus on the selected tab', async () => {
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

  it('renders the vertical game list on the wide layout', () => {
    useLayout(true)
    render(<EntryPage />)

    const tablist = screen.getByRole('tablist', { name: '게임 선택' })
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical')
    expect(within(tablist).getAllByRole('tab')).toHaveLength(5)
    expect(within(tablist).getByText('05')).toBeVisible()
  })

  it('walks the vertical game list with the keyboard and wraps around', async () => {
    useLayout(true)
    const user = userEvent.setup()
    render(<EntryPage />)

    const tabs = within(screen.getByRole('tablist', { name: '게임 선택' })).getAllByRole('tab')
    const [first] = tabs
    const last = tabs[tabs.length - 1]
    if (!first || !last) throw new Error('game list is empty')

    first.focus()
    await user.keyboard('{End}')
    expect(last).toHaveFocus()
    expect(last).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '낚시' })).toBeVisible()

    await user.keyboard('{ArrowDown}')
    expect(first).toHaveFocus()
    expect(screen.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
  })

  it('asks before reconnecting a preserved room session', async () => {
    const user = userEvent.setup()
    useAppStore.getState().setRoomSession(creatorSession)
    useAppStore.getState().endSession('disconnected')

    render(<EntryPage />)

    const recovery = screen.getByRole('region', { name: '진행 중인 방' })
    expect(within(recovery).getByText('진행 중인 방이 있어요')).toBeVisible()
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
