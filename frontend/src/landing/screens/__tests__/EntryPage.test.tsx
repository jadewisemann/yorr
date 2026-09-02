import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntryPage } from '@/landing/screens/EntryPage'
import { creatorSession } from '@/mocks/fixtures'
import { useAppStore } from '@/store'
import { installMatchMedia } from '@/test/mediaQuery'
import { navigateSpy } from '@/test/routerDouble'

const { closeSession } = vi.hoisted(() => ({ closeSession: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@tanstack/react-router', async () =>
  (await import('@/test/routerDouble')).routerWithNavigateSpy(),
)

const { renameProfile } = vi.hoisted(() => ({ renameProfile: vi.fn() }))

vi.mock('@/auth/api/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/api/authApi')>()),
  closeSession: (token: string) => closeSession(token),
  renameProfile: (token: string, nickname: string) => renameProfile(token, nickname),
}))

function useLayout(wide: boolean) {
  installMatchMedia(wide)
}

function codeDialog() {
  return within(screen.getByRole('dialog', { name: '초대받은 방에 참가' }))
}

/** 게임 탭을 고르고 플레이 대화상자를 연다. 대화상자 안을 보는 검사들이 여기서 출발한다. */
async function openPlayDialog(tab: RegExp, play: string) {
  const user = userEvent.setup()
  render(<EntryPage />)
  await user.click(screen.getByRole('tab', { name: tab }))
  await user.click(screen.getByRole('button', { name: play }))
  return user
}

/** 회원으로 로그인한 채 화면을 그리고 계정 메뉴에서 로그아웃까지 누른다. */
async function signOutFromAccountMenu() {
  const user = userEvent.setup()
  useAppStore
    .getState()
    .signIn({ userId: 'member-1', nickname: '카카오회원', sessionToken: 'token-1' })

  render(<EntryPage />)
  await user.click(screen.getByRole('button', { name: /카카오회원/ }))
  await user.click(
    within(screen.getByRole('dialog', { name: '내 계정' })).getByRole('button', {
      name: '로그아웃',
    }),
  )
}

/** 요트 다이스의 플레이 대화상자를 연다 — 탭을 옮기지 않는 기본 게임이다. */
async function openYachtPlayDialog() {
  const user = userEvent.setup()
  render(<EntryPage />)
  await user.click(screen.getByRole('button', { name: '요트 다이스 플레이' }))
  return user
}

describe('EntryPage', () => {
  beforeEach(() => {
    navigateSpy.mockReset()
    closeSession.mockClear()
    renameProfile.mockReset()
    useAppStore.getState().reset()
    useAppStore.getState().signOut()
    useLayout(false)
  })
  afterEach(() => vi.restoreAllMocks())

  it('opens on the released game with its play call to action', () => {
    render(<EntryPage />)

    expect(screen.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
    expect(screen.getByRole('button', { name: '요트 다이스 플레이' })).toBeVisible()
  })

  it('쿼리스트링이 가리키는 게임에서 열리고, 카드를 넘기면 URL을 덮어쓴다', async () => {
    const user = userEvent.setup()
    render(<EntryPage gameKey="duel" />)

    expect(screen.getByRole('heading', { name: '석양이 진다' })).toBeVisible()

    await user.click(screen.getByRole('tab', { name: /탁구/ }))

    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/',
      search: { game: 'pingpong' },
      replace: true,
      viewTransition: false,
    })
  })

  it('모르는 게임 키로 들어오면 첫 게임으로 연다', () => {
    render(<EntryPage gameKey={'nope' as never} />)

    expect(screen.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
  })

  it('랜딩에서 소리를 끄면 설정이 저장돼 다음 화면까지 이어진다', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    const on = screen.getByRole('button', { name: '소리 끄기' })
    expect(on).toHaveAttribute('aria-pressed', 'true')

    await user.click(on)
    expect(localStorage.getItem('yorr.sound-muted')).toBe('true')

    const off = screen.getByRole('button', { name: '소리 켜기' })
    expect(off).toHaveAttribute('aria-pressed', 'false')

    await user.click(off)
    expect(localStorage.getItem('yorr.sound-muted')).toBe('false')
  })

  it.each([
    ['narrow', false],
    ['wide', true],
  ])('opens nickname entry for a new room (%s)', async (_layout, wide) => {
    const user = userEvent.setup()
    useLayout(wide)
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '요트 다이스 플레이' }))
    await user.click(screen.getByRole('button', { name: /방 만들기/ }))

    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/join',
      search: { code: undefined, game: 'yacht' },
    })
  })

  it('빠른 대전은 로그인한 사람만 대기열로 보낸다', async () => {
    const user = await openYachtPlayDialog()
    await user.click(screen.getByRole('button', { name: /온라인 대전/ }))
    expect(navigateSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '로그인' })).toBeVisible()

    useAppStore.getState().signIn({
      userId: 'member-1',
      nickname: '카카오회원',
      sessionToken: 'token-1',
    })
    await user.click(screen.getByRole('button', { name: '요트 다이스 플레이' }))
    await user.click(screen.getByRole('button', { name: /온라인 대전/ }))

    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/join',
      search: { code: undefined, game: 'yacht', mode: 'quick' },
    })
  })

  it('opens the ping pong party dashboard from the primary play button', async () => {
    const user = await openPlayDialog(/탁구/, '탁구 플레이')
    await user.click(screen.getByRole('button', { name: /방 만들기/ }))

    expect(navigateSpy).toHaveBeenCalledWith({ to: '/party', search: { game: 'pingpong' } })
  })

  it.each([
    ['narrow', false],
    ['wide', true],
  ])('opens ping pong AI play from the mode card (%s)', async (_layout, wide) => {
    useLayout(wide)
    const user = await openPlayDialog(/탁구/, '탁구 플레이')
    await user.click(screen.getByRole('button', { name: /AI와 대전/ }))

    expect(navigateSpy).toHaveBeenCalledWith({ to: '/pingpong' })
  })

  it('shows game-specific mode cards in the play dialog', async () => {
    const user = await openPlayDialog(/탁구/, '탁구 플레이')
    const pingpong = within(screen.getByRole('dialog', { name: '탁구 시작하기' }))
    expect(pingpong.getByRole('button', { name: /AI와 대전/ })).toBeVisible()
    expect(pingpong.queryByRole('button', { name: /파티 모드/ })).not.toBeInTheDocument()
    expect(pingpong.queryByRole('button', { name: /튜토리얼/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('tab', { name: /석양이 진다/ }))
    await user.click(screen.getByRole('button', { name: '석양이 진다 플레이' }))
    const duel = within(screen.getByRole('dialog', { name: '석양이 진다 시작하기' }))
    expect(duel.getByRole('button', { name: /파티 모드/ })).toBeVisible()

    await user.click(duel.getByRole('button', { name: /파티 모드/ }))
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/party', search: { game: 'duel' } })
  })

  it('처음 온 사람은 방을 만들지 않고 연습 모드로 바로 들어간다', async () => {
    const user = await openYachtPlayDialog()
    await user.click(screen.getByRole('button', { name: /튜토리얼/ }))

    expect(navigateSpy).toHaveBeenCalledWith({ to: '/tutorial' })
  })

  it('locks the call to action for a game that has not shipped', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('tab', { name: /라이어스 다이스/ }))

    expect(screen.getByRole('heading', { name: '라이어스 다이스' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /플레이$/ })).not.toBeInTheDocument()
    const locked = screen.getByRole('button', { name: '준비 중인 게임' })
    expect(locked).toBeDisabled()

    const codeEntry = screen.getByRole('button', { name: '초대 코드로 참가' })
    expect(codeEntry).toBeEnabled()
    expect(codeEntry.parentElement).not.toBe(locked.parentElement)
  })

  it('wraps around the carousel tablist with the arrow keys and keeps focus on the selection', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    const firstTab = screen.getByRole('tab', { name: /요트 다이스/ })
    firstTab.focus()
    await user.keyboard('{ArrowLeft}')

    const lastTab = screen.getByRole('tab', { name: /라이어스 다이스/ })
    expect(lastTab).toHaveFocus()
    expect(lastTab).toHaveAttribute('aria-selected', 'true')
    expect(lastTab).toHaveAttribute('tabindex', '0')
    expect(firstTab).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('heading', { name: '라이어스 다이스' })).toBeVisible()
  })

  it('steps through the carousel with the arrow buttons on the wide layout', async () => {
    useLayout(true)
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '다음 게임' }))

    expect(screen.getByRole('heading', { name: '탁구' })).toBeVisible()
    expect(screen.getByRole('tab', { name: /탁구/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('wraps the carousel at both ends with the arrow buttons', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '이전 게임' }))
    expect(screen.getByRole('heading', { name: '라이어스 다이스' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: '다음 게임' }))
    expect(screen.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
  })

  it('keeps the carousel arrows on the narrow layout', () => {
    render(<EntryPage />)

    expect(screen.getByRole('button', { name: '이전 게임' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '다음 게임' })).toBeEnabled()
  })

  it('sanitizes the room code in the code dialog and only enables join once it is valid', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '초대 코드로 참가' }))
    const dialog = codeDialog()
    const input = dialog.getByRole('textbox', { name: '방 코드' })
    expect(dialog.getByRole('button', { name: '코드로 참가' })).toBeDisabled()

    await user.type(input, 'yo!r')
    expect(input).toHaveValue('YOR')
    expect(dialog.getByRole('button', { name: '코드로 참가' })).toBeDisabled()

    await user.type(input, 'r64')
    expect(input).toHaveValue('YORR64')

    await user.click(dialog.getByRole('button', { name: '코드로 참가' }))
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/join', search: { code: 'YORR64' } })
  })

  it('closes the code dialog again without joining', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '초대 코드로 참가' }))
    await user.click(codeDialog().getByRole('button', { name: '코드 입력 닫기' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(navigateSpy).not.toHaveBeenCalled()
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
    expect(navigateSpy).toHaveBeenCalledWith({
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

  it.each([
    ['narrow', false],
    ['wide', true],
  ])('offers login in the header and keeps code entry in the CTA (%s)', (_layout, wide) => {
    useLayout(wide)
    render(<EntryPage />)

    expect(screen.getByRole('button', { name: '로그인' })).toBeVisible()
    expect(screen.getByRole('button', { name: '초대 코드로 참가' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '방 코드로 참가' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /카카오/ })).not.toBeInTheDocument()
  })

  it.each([
    ['narrow', false],
    ['wide', true],
  ])('renders dialogs outside the inert background (%s)', async (_layout, wide) => {
    const user = userEvent.setup()
    useLayout(wide)
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '로그인' }))
    expect(screen.getByRole('dialog', { name: '로그인' }).closest('main')).toBeNull()

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '초대 코드로 참가' }))
    expect(screen.getByRole('dialog', { name: '초대받은 방에 참가' }).closest('main')).toBeNull()
  })

  it.each([
    ['narrow', false],
    ['wide', true],
  ])('lets the user pick a provider inside the dialog (%s)', async (_layout, wide) => {
    const user = userEvent.setup()
    useLayout(wide)
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '로그인' }))
    const dialog = within(screen.getByRole('dialog', { name: '로그인' }))

    expect(dialog.getByRole('button', { name: '카카오로 계속하기' })).toBeEnabled()
    expect(dialog.getByRole('button', { name: '구글로 계속하기' })).toBeEnabled()
  })

  it('shows the signed-in nickname and signs out from the account menu', async () => {
    const user = userEvent.setup()
    useAppStore
      .getState()
      .signIn({ userId: 'member-1', nickname: '카카오회원', sessionToken: 'token-1' })

    render(<EntryPage />)
    expect(screen.getByRole('button', { name: /카카오회원/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: '로그인' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /카카오회원/ }))
    const menu = within(screen.getByRole('dialog', { name: '내 계정' }))
    expect(menu.getByRole('button', { name: '프로필 관리' })).toBeEnabled()
    expect(menu.getByRole('button', { name: /내 전적/ })).toBeDisabled()

    await user.click(menu.getByRole('button', { name: '로그아웃' }))

    expect(useAppStore.getState().authSession).toBeNull()
    expect(localStorage.getItem('yorr.auth-session')).toBeNull()
    expect(screen.getByRole('button', { name: '로그인' })).toBeVisible()
    expect(closeSession).toHaveBeenCalledWith('token-1')
  })

  it('signs out locally even when the server call fails', async () => {
    closeSession.mockRejectedValueOnce(new Error('network down'))

    await signOutFromAccountMenu()

    expect(useAppStore.getState().authSession).toBeNull()
  })

  it('renames the profile from the account menu', async () => {
    const user = userEvent.setup()
    renameProfile.mockResolvedValue({
      userId: 'member-1',
      nickname: '바꾼이름',
      profileImageUrl: null,
    })
    useAppStore
      .getState()
      .signIn({ userId: 'member-1', nickname: '플레이어', sessionToken: 'token-1' })

    render(<EntryPage />)
    await user.click(screen.getByRole('button', { name: /플레이어/ }))
    const menu = within(screen.getByRole('dialog', { name: '내 계정' }))
    await user.click(menu.getByRole('button', { name: '프로필 관리' }))

    const input = menu.getByRole('textbox', { name: '닉네임' })
    await user.clear(input)
    await user.type(input, '바꾼이름')
    await user.click(menu.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(renameProfile).toHaveBeenCalledWith('token-1', '바꾼이름'))
    await waitFor(() => {
      expect(useAppStore.getState().authSession?.nickname).toBe('바꾼이름')
    })
    expect(screen.getByRole('button', { name: /바꾼이름/ })).toBeVisible()
  })

  it('keeps the old name when the rename fails', async () => {
    const user = userEvent.setup()
    renameProfile.mockRejectedValue(new Error('500'))
    useAppStore
      .getState()
      .signIn({ userId: 'member-1', nickname: '원래이름', sessionToken: 'token-1' })

    render(<EntryPage />)
    await user.click(screen.getByRole('button', { name: /원래이름/ }))
    const menu = within(screen.getByRole('dialog', { name: '내 계정' }))
    await user.click(menu.getByRole('button', { name: '프로필 관리' }))
    await user.clear(menu.getByRole('textbox', { name: '닉네임' }))
    await user.type(menu.getByRole('textbox', { name: '닉네임' }), '실패할이름')
    await user.click(menu.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(menu.getByRole('alert')).toBeVisible())
    expect(useAppStore.getState().authSession?.nickname).toBe('원래이름')
  })

  it('keeps the room session when signing out', async () => {
    useAppStore.getState().setRoomSession(creatorSession)

    await signOutFromAccountMenu()

    expect(useAppStore.getState().authSession).toBeNull()
    expect(useAppStore.getState().roomSession).not.toBeNull()
  })
})
