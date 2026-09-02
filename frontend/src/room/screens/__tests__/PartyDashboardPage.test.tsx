import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  creatorPlayer,
  creatorSession,
  dashboardSession,
  waitingRoomSnapshot,
} from '@/mocks/fixtures'
import { PartyDashboardPage } from '@/room/screens/PartyDashboardPage'
import { useAppStore } from '@/store'
import { navigateSpy } from '@/test/routerDouble'

vi.mock('@tanstack/react-router', async () =>
  (await import('@/test/routerDouble')).routerWithNavigateSpy(),
)

vi.mock('@/shared/audio/soundtrack', () => ({
  playLandingSoundtrack: vi.fn(() => () => {}),
}))

describe('PartyDashboardPage', () => {
  beforeEach(() => {
    navigateSpy.mockReset()
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

  it('방 코드와 참가 안내를 보여준다', async () => {
    givenDashboard()

    render(<PartyDashboardPage gameKey="yacht" />)

    expect(await screen.findAllByText(dashboardSession.roomCode)).toHaveLength(2)
    expect(screen.getByText('폰으로 QR을 찍으면 바로 참여해요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '방 닫기' })).toBeInTheDocument()
  })

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

  it('조작 버튼 대신 방장이 시작한다는 것을 알린다', async () => {
    givenDashboard('connected')

    render(<PartyDashboardPage gameKey="yacht" />)

    expect(
      await screen.findByText(`${creatorPlayer.nickname} 님이 폰에서 게임을 시작할 수 있어요.`),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '게임 시작' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '봇 추가' })).not.toBeInTheDocument()
  })

  it('참가자가 없으면 먼저 들어온 사람이 방장이 된다고 알린다', async () => {
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

  it('참가자 목록에서 방장을 표시한다', async () => {
    givenDashboard('connected')

    render(<PartyDashboardPage gameKey="yacht" />)

    const column = await screen.findByRole('region', { name: /참가자/ })
    expect(column).toHaveTextContent('방장')
  })

  it('게임이 시작되면 게임 화면으로 이동한다', async () => {
    givenDashboard('connected')
    useAppStore.getState().replaceRoomSnapshot({ ...waitingRoomSnapshot, phase: 'playing' })

    render(<PartyDashboardPage gameKey="yacht" />)

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ to: '/rooms/$roomId/game', replace: true }),
      ),
    )
  })

  it('이전 일반 방의 진행 상태로 파티 화면을 이동시키지 않는다', () => {
    useAppStore.getState().setRoomSession({
      ...creatorSession,
      snapshot: { ...waitingRoomSnapshot, phase: 'playing' },
    })

    render(<PartyDashboardPage gameKey="pingpong" />)

    expect(navigateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: '/rooms/$roomId/game' }),
    )
  })

  function givenDashboard(connectionStatus: 'connected' | 'connecting' = 'connected') {
    useAppStore.getState().setRoomSession({ ...dashboardSession, snapshot: waitingRoomSnapshot })
    useAppStore.getState().setConnectionStatus(connectionStatus)
  }
})
