import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntryPage } from '@/landing/screens/EntryPage'
import { creatorSession } from '@/mocks/fixtures'
import { useAppStore } from '@/store'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
const { closeSession } = vi.hoisted(() => ({ closeSession: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

const { renameProfile } = vi.hoisted(() => ({ renameProfile: vi.fn() }))

vi.mock('@/auth/api/authApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/api/authApi')>()),
  closeSession: (token: string) => closeSession(token),
  renameProfile: (token: string, nickname: string) => renameProfile(token, nickname),
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
    closeSession.mockClear()
    renameProfile.mockReset()
    useAppStore.getState().reset()
    useLayout(false)
  })
  afterEach(() => vi.restoreAllMocks())

  it('opens on the released game with its play call to action', () => {
    render(<EntryPage />)

    expect(screen.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
    // "지금 플레이 가능"은 눌리는 CTA가 말한다 — PLAYABLE NOW 배지는 같은 말의 중복이었다.
    expect(screen.getByRole('button', { name: '요트 다이스 플레이' })).toBeVisible()
  })

  // 랜딩은 진입하자마자 BGM이 흐른다. 게임 화면과 같은 저장 설정을 써야, 조용한 곳에서
  // 한 번 끈 사람이 대기실·게임으로 넘어가서 다시 소리를 듣지 않는다.
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

  it('opens nickname entry for a new room', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '요트 다이스 플레이' }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/join',
      search: { code: undefined, game: 'yacht' },
    })
  })

  it('opens the ping pong party dashboard from the primary play button', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('tab', { name: /탁구/ }))
    await user.click(screen.getByRole('button', { name: '탁구 친구와 대전' }))

    expect(navigate).toHaveBeenCalledWith({ to: '/party', search: { game: 'pingpong' } })
  })

  it.each([
    ['narrow', false],
    ['wide', true],
  ])('opens ping pong AI play from the secondary button (%s)', async (_layout, wide) => {
    const user = userEvent.setup()
    useLayout(wide)
    render(<EntryPage />)

    await user.click(screen.getByRole('tab', { name: /탁구/ }))
    await user.click(screen.getByRole('button', { name: '탁구 AI와 대전' }))

    expect(navigate).toHaveBeenCalledWith({ to: '/pingpong' })
  })

  it('처음 온 사람은 방을 만들지 않고 연습 모드로 바로 들어간다', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: /튜토리얼로 연습하기/ }))

    // 연습은 실전과 다른 화면이다 — /join을 거치지 않는다.
    expect(navigate).toHaveBeenCalledWith({ to: '/tutorial' })
  })

  it('locks the call to action for a game that has not shipped', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('tab', { name: /라이어스 다이스/ }))

    // 준비 중인 게임에는 연습할 것이 아직 없다.
    expect(screen.queryByRole('button', { name: /튜토리얼로 연습하기/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '라이어스 다이스' })).toBeVisible()
    // COMING SOON 배지도 마찬가지 — 못 누르는 회색 버튼이 같은 사실을 더 강하게 말한다.
    expect(screen.queryByRole('button', { name: /플레이$/ })).not.toBeInTheDocument()
    const locked = screen.getByRole('button', { name: '준비 중인 게임' })
    expect(locked).toBeDisabled()

    // 코드 참가는 게임 선택과 무관한 독립 경로다 — 어떤 게임이 선택돼 있든 살아 있어야 하고,
    // 게임 CTA와 같은 부모에 나란히 서면 "이 게임을 코드로 연다"로 읽힌다.
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

    await user.click(screen.getByRole('button', { name: '다음 게임' }))

    expect(screen.getByRole('heading', { name: '라이어스 다이스' })).toBeVisible()
    expect(screen.getByRole('tab', { name: /라이어스 다이스/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  // 목록이 순환하므로 화살표는 끝에서도 비활성이 되지 않는다 — 점 목록 방향키와 같은 규칙이다.
  it('wraps the carousel at both ends with the arrow buttons', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    // 첫 게임에서 이전 → 마지막으로 감싼다.
    await user.click(screen.getByRole('button', { name: '이전 게임' }))
    expect(screen.getByRole('heading', { name: '낚시' })).toBeVisible()

    // 마지막에서 다음 → 다시 처음으로.
    await user.click(screen.getByRole('button', { name: '다음 게임' }))
    expect(screen.getByRole('heading', { name: '요트 다이스' })).toBeVisible()
  })

  // 스와이프는 발견 가능한 조작이 아니다 — 모바일에도 명시적인 이동 버튼이 있어야 한다.
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
    expect(navigate).toHaveBeenCalledWith({ to: '/join', search: { code: 'YORR64' } })
  })

  it('closes the code dialog again without joining', async () => {
    const user = userEvent.setup()
    render(<EntryPage />)

    await user.click(screen.getByRole('button', { name: '초대 코드로 참가' }))
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

  /**
   * 헤더의 '방 코드로 참가'는 하단 CTA와 같은 일을 하고 있었다. 그 자리를 계정으로 넘기면서
   * 코드 참가의 입구가 사라지지 않았는지도 함께 확인한다 — 좁은 화면에서는 헤더가 유일한
   * 입구였다.
   */
  it.each([
    ['narrow', false],
    ['wide', true],
  ])('offers login in the header and keeps code entry in the CTA (%s)', (_layout, wide) => {
    useLayout(wide)
    render(<EntryPage />)

    expect(screen.getByRole('button', { name: '로그인' })).toBeVisible()
    expect(screen.getByRole('button', { name: '초대 코드로 참가' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '방 코드로 참가' })).not.toBeInTheDocument()
    // 제공자는 곧 늘어난다. 헤더가 카카오 하나에 자리를 내주면 구글을 붙일 데가 없다.
    expect(screen.queryByRole('button', { name: /카카오/ })).not.toBeInTheDocument()
  })

  /**
   * useDialogBackground가 배경 `<main>`에 inert를 건다. 다이얼로그가 그 안에 있으면 열리는
   * 순간 자기 자신을 잠가 아무것도 눌리지 않는다 — 계정 다이얼로그를 헤더 안에 뒀다가 실제로
   * 그렇게 됐다. jsdom은 inert를 구현하지 않아 클릭 테스트로는 잡히지 않으므로 위치를 본다.
   */
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
    // 전적 화면은 아직 없다 — 자리만 보이고 눌리지 않아야 한다.
    expect(menu.getByRole('button', { name: /내 전적/ })).toBeDisabled()

    await user.click(menu.getByRole('button', { name: '로그아웃' }))

    expect(useAppStore.getState().authSession).toBeNull()
    expect(localStorage.getItem('yorr.auth-session')).toBeNull()
    expect(screen.getByRole('button', { name: '로그인' })).toBeVisible()
    // 로컬만 지우면 그 토큰은 남은 30일 동안 서버에서 유효한 채로 남는다.
    expect(closeSession).toHaveBeenCalledWith('token-1')
  })

  /** 서버가 응답하지 않아도 로그아웃은 되어야 한다 — 로컬 정리가 서버 사정에 묶이면 안 된다. */
  it('signs out locally even when the server call fails', async () => {
    const user = userEvent.setup()
    closeSession.mockRejectedValueOnce(new Error('network down'))
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

    expect(useAppStore.getState().authSession).toBeNull()
  })

  /**
   * 로그인 직후 이름이 "플레이어"로 들어오는 경우가 있어(동의항목 문제), 사용자가 스스로
   * 고칠 수 있어야 한다. 별도 화면 없이 계정 메뉴 안에서 끝난다.
   */
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
    // 서버가 돌려준 이름을 그대로 쓴다. 헤더까지 즉시 바뀌어야 바뀐 것이 보인다.
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

  /** 로그아웃이 진행 중인 방까지 끊으면 안 된다 — 두 세션은 수명이 다르다. */
  it('keeps the room session when signing out', async () => {
    const user = userEvent.setup()
    useAppStore.getState().setRoomSession(creatorSession)
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

    expect(useAppStore.getState().authSession).toBeNull()
    expect(useAppStore.getState().roomSession).not.toBeNull()
  })
})
