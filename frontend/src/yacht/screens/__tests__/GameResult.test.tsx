import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyScoreBoard, creatorSession } from '@/mocks/fixtures'
import type { RoomSnapshot, ScoreBoard } from '@/realtime/wsEvents'
import { roomApiClient } from '@/room/api/roomApi'
import { useAppStore } from '@/store'
import { GameResult } from '@/yacht/screens/GameResult'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

const { snapshot: _snapshot, ...hostSession } = creatorSession

function boardWithTotal(total: number): ScoreBoard {
  return { ...createEmptyScoreBoard(), total }
}

const finishedSnapshot = {
  roomId: hostSession.roomId,
  phase: 'finished',
  hostId: hostSession.you,
  players: [
    { playerId: hostSession.you, nickname: '민지', status: 'online' },
    { playerId: 'player-participant', nickname: '지훈', status: 'online' },
    { playerId: 'p3', nickname: '아주긴닉네임입니다', status: 'online' },
  ],
  game: {
    activePlayerId: hostSession.you,
    roundNumber: 12,
    roundDeadline: 0,
    rollCount: 0,
    scores: {
      [hostSession.you]: boardWithTotal(198),
      'player-participant': boardWithTotal(214),
      p3: boardWithTotal(176),
    },
  },
} satisfies RoomSnapshot

const finishedGame = finishedSnapshot.game
if (!finishedGame) throw new Error('finished snapshot is missing game')

describe('GameResult', () => {
  beforeEach(() => {
    navigate.mockReset()
    vi.restoreAllMocks()
    useAppStore.getState().reset()
    useAppStore.getState().setRoomSession(creatorSession)
  })

  it('ranks players by total and highlights my place', () => {
    render(
      <GameResult onLeaveRequest={() => {}} session={hostSession} snapshot={finishedSnapshot} />,
    )

    expect(screen.getByRole('heading', { name: '2위' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('게임 종료, 3명 중 2위, 198점')

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('지훈')
    expect(rows[0]).toHaveTextContent('214')
    expect(rows[1]).toHaveTextContent('민지(나)')
  })

  it('never exposes a player id when a ranking nickname is unavailable', () => {
    const missingPlayerId = '16ba1fd1-d8b2-4da0-a7f3-88d23b5361ff'
    render(
      <GameResult
        onLeaveRequest={() => {}}
        session={hostSession}
        snapshot={{
          ...finishedSnapshot,
          players: finishedSnapshot.players.filter(
            (player) => player.playerId !== 'player-participant',
          ),
          game: {
            ...finishedSnapshot.game,
            rankings: [
              { rank: 1, playerId: missingPlayerId, total: 214 },
              { rank: 2, playerId: hostSession.you, total: 198 },
            ],
          },
        }}
      />,
    )

    expect(screen.getByText('알 수 없는 참가자')).toBeVisible()
    expect(screen.queryByText(missingPlayerId)).not.toBeInTheDocument()
  })

  it('lets the host move everyone back to the lobby and asks before anyone leaves', async () => {
    const user = userEvent.setup()
    const onLeaveRequest = vi.fn()
    render(
      <GameResult
        onLeaveRequest={onLeaveRequest}
        session={hostSession}
        snapshot={finishedSnapshot}
      />,
    )

    expect(screen.getByRole('button', { name: '대기실로' })).toBeEnabled()
    expect(screen.getByText('대기실로 돌아가면 같은 멤버로 다시 시작할 수 있어요')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '나가기' }))
    expect(onLeaveRequest).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('blocks the lobby move for participants', () => {
    render(
      <GameResult
        onLeaveRequest={() => {}}
        session={hostSession}
        snapshot={{ ...finishedSnapshot, hostId: 'player-participant' }}
      />,
    )

    expect(screen.getByRole('button', { name: '대기실로' })).toBeDisabled()
    expect(screen.getByText('방장이 대기실로 옮기기를 기다리는 중')).toBeVisible()
  })

  it('opens the full scoresheet in a sheet', async () => {
    const user = userEvent.setup()
    render(
      <GameResult onLeaveRequest={() => {}} session={hostSession} snapshot={finishedSnapshot} />,
    )

    await user.click(screen.getByRole('button', { name: '전체 점수표 보기' }))

    const sheet = await screen.findByRole('dialog', { name: '전체 점수표' })
    expect(within(sheet).getByRole('columnheader', { name: '나' })).toBeVisible()
    expect(within(sheet).getAllByRole('rowheader')[0]).toHaveTextContent('에이스')

    await user.click(screen.getByRole('button', { name: '시트 닫기' }))
    expect(screen.queryByRole('dialog', { name: '전체 점수표' })).not.toBeInTheDocument()
  })

  it('서버가 확정한 순위를 로컬 점수 합계보다 우선한다', () => {
    render(
      <GameResult
        onLeaveRequest={() => {}}
        session={hostSession}
        snapshot={{
          ...finishedSnapshot,
          game: {
            ...finishedGame,
            rankings: [
              { rank: 1, playerId: hostSession.you, total: 231 },
              { rank: 2, playerId: 'player-participant', total: 214 },
              { rank: 3, playerId: 'p3', total: 176 },
            ],
          },
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: '1위' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('게임 종료, 3명 중 1위, 231점')
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('민지(나)')
  })

  it('동점이면 내 자리를 위로 올려 스스로 찾기 쉽게 한다', () => {
    render(
      <GameResult
        onLeaveRequest={() => {}}
        session={hostSession}
        snapshot={{
          ...finishedSnapshot,
          game: {
            ...finishedGame,
            scores: {
              [hostSession.you]: boardWithTotal(198),
              'player-participant': boardWithTotal(198),
              p3: boardWithTotal(176),
            },
          },
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: '1위' })).toBeVisible()
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('민지(나)')
  })

  it('호스트가 대기실로 돌릴 때 혼자 먼저 이동하지 않고 서버 신호를 기다린다', async () => {
    const user = userEvent.setup()
    const returnToLobby = vi.spyOn(roomApiClient, 'returnToLobby')
    render(
      <GameResult onLeaveRequest={() => {}} session={hostSession} snapshot={finishedSnapshot} />,
    )

    await user.click(screen.getByRole('button', { name: '대기실로' }))

    await waitFor(() => expect(returnToLobby).toHaveBeenCalledOnce())
    expect(returnToLobby).toHaveBeenCalledWith(
      hostSession.roomCode,
      expect.objectContaining({ sessionToken: hostSession.sessionToken, userId: hostSession.you }),
    )
    expect(navigate).not.toHaveBeenCalled()
  })

  describe('파티 모드 대시보드', () => {
    const dashboard = { ...hostSession, membershipRole: 'dashboard' as const, you: 'dashboard-1' }

    beforeEach(() => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn().mockReturnValue({
          matches: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
      )
    })

    it('개인 결과 대신 모두의 순위를 보여준다', () => {
      render(
        <GameResult
          onLeaveRequest={() => {}}
          session={dashboard}
          snapshot={{ ...finishedSnapshot, hostId: 'player-participant' }}
        />,
      )

      expect(screen.queryByRole('heading', { name: /위$/ })).not.toBeInTheDocument()
      expect(screen.queryByText('ME')).not.toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
      expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('지훈')
    })

    it('대기실로 버튼 없이 방장을 기다린다고 알린다', () => {
      render(
        <GameResult
          onLeaveRequest={() => {}}
          session={dashboard}
          snapshot={{ ...finishedSnapshot, hostId: 'player-participant' }}
        />,
      )

      expect(screen.queryByRole('button', { name: '대기실로' })).not.toBeInTheDocument()
      expect(screen.getByText('방장이 대기실로 옮기면 같은 멤버로 다시 시작해요.')).toBeVisible()
      expect(screen.getByRole('button', { name: '방 닫기' })).toBeVisible()
    })

    it('전체 점수표를 펼친 채로 보여준다', () => {
      render(
        <GameResult
          onLeaveRequest={() => {}}
          session={dashboard}
          snapshot={{ ...finishedSnapshot, hostId: 'player-participant' }}
        />,
      )

      const sheet = screen.getByRole('region', { name: '전체 점수표' })
      expect(within(sheet).getByRole('columnheader', { name: '지훈' })).toBeVisible()
      expect(within(sheet).queryByRole('columnheader', { name: '나' })).not.toBeInTheDocument()
    })
  })
})
