import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { creatorPlayer, dashboardSession, waitingRoomSnapshot } from '@/mocks/fixtures'
import { PartyDashboardPage } from '@/room/screens/PartyDashboardPage'
import { useAppStore } from '@/store'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

vi.mock('@/shared/audio/soundtrack', () => ({
  playLandingSoundtrack: vi.fn(() => () => {}),
}))

describe('PartyDashboardPage', () => {
  beforeEach(() => {
    navigate.mockReset()
    // wide(≥1024px) 분기 — 참가자 열이 그려지는 쪽이다.
    // useMediaQuery가 change를 구독하므로 리스너 API까지 있어야 한다.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )
    useAppStore.getState().reset()
  })

  /** 대시보드는 닉네임 화면을 거치지 않고 바로 방 코드·QR을 띄운다. */
  it('방 코드와 참가 안내를 보여준다', async () => {
    givenDashboard()

    render(<PartyDashboardPage gameKey="yacht" />)

    // 헤더의 작은 코드와 QR 옆 큰 코드 — 방 건너 읽는 화면이라 두 곳에 함께 있다.
    expect(await screen.findAllByText(dashboardSession.roomCode)).toHaveLength(2)
    expect(screen.getByText('폰으로 QR을 찍으면 바로 참여해요.')).toBeInTheDocument()
    // 대시보드는 플레이어가 아니므로 '나가기'가 아니라 방을 닫는다.
    expect(screen.getByRole('button', { name: '방 닫기' })).toBeInTheDocument()
  })

  /**
   * 대시보드는 플레이어 명단에 없다 — `you`가 참가자 목록에 나타나면 서버 계약이 깨진 것이다
   * (백엔드가 party 방 생성 시 join을 건너뛴다).
   */
  it('참가자 목록에 자기 자신을 넣지 않는다', async () => {
    givenDashboard()

    render(<PartyDashboardPage gameKey="yacht" />)

    const column = await screen.findByRole('region', { name: /참가자/ })
    expect(column).toHaveTextContent(creatorPlayer.nickname)
    expect(column).not.toHaveTextContent(dashboardSession.nickname)
  })

  it('연결을 기다리는 동안 그 사실을 알린다', async () => {
    givenDashboard('connecting')

    render(<PartyDashboardPage gameKey="yacht" />)

    expect(await screen.findByText('실시간 연결을 기다리고 있어요.')).toBeInTheDocument()
  })

  /**
   * 대시보드는 방장이 아니다 — 조작 버튼을 두면 서버가 403으로 막는 버튼을 TV에 세우는 셈이다.
   * 대신 누구 폰을 봐야 하는지 이름으로 알린다.
   */
  it('조작 버튼 대신 방장이 시작한다는 것을 알린다', async () => {
    givenDashboard('connected')

    render(<PartyDashboardPage gameKey="yacht" />)

    expect(
      await screen.findByText(`${creatorPlayer.nickname} 님이 폰에서 게임을 시작할 수 있어요.`),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '게임 시작' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '봇 추가' })).not.toBeInTheDocument()
  })

  /** 아직 아무도 없으면 이름을 지어낼 수 없다 — 규칙만 알린다. */
  it('참가자가 없으면 먼저 들어온 사람이 방장이 된다고 알린다', async () => {
    // 방장 없는 방 = hostId 키가 아예 없는 상태다(exactOptionalPropertyTypes).
    const { hostId: _hostId, ...hostlessSnapshot } = waitingRoomSnapshot
    useAppStore.getState().setRoomSession({
      ...dashboardSession,
      snapshot: { ...hostlessSnapshot, players: [] },
    })
    useAppStore.getState().setConnectionStatus('connected')

    render(<PartyDashboardPage gameKey="yacht" />)

    expect(
      await screen.findByText('먼저 들어온 사람이 폰에서 게임을 시작할 수 있어요.'),
    ).toBeInTheDocument()
  })

  /** 시작 버튼이 이 화면에 없으므로, 누구 폰을 봐야 하는지가 목록에도 남아야 한다. */
  it('참가자 목록에서 방장을 표시한다', async () => {
    givenDashboard('connected')

    render(<PartyDashboardPage gameKey="yacht" />)

    const column = await screen.findByRole('region', { name: /참가자/ })
    expect(column).toHaveTextContent('방장')
  })

  /** 시작되면 방 전체가 함께 움직인다 — 대시보드도 관전 뷰로 넘어간다. */
  it('게임이 시작되면 게임 화면으로 이동한다', async () => {
    givenDashboard('connected')
    useAppStore.getState().replaceRoomSnapshot({ ...waitingRoomSnapshot, phase: 'playing' })

    render(<PartyDashboardPage gameKey="yacht" />)

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: '/rooms/$roomId/game', replace: true }),
      ),
    )
  })

  function givenDashboard(connectionStatus: 'connected' | 'connecting' = 'connected') {
    useAppStore.getState().setRoomSession({ ...dashboardSession, snapshot: waitingRoomSnapshot })
    useAppStore.getState().setConnectionStatus(connectionStatus)
  }
})
