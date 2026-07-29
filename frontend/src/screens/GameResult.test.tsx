import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyScoreBoard, creatorSession } from '@/mocks/fixtures'
import type { RoomSnapshot, ScoreBoard } from '@/realtime/wsEvents'
import { GameResult } from './GameResult'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

const { snapshot: _snapshot, ...hostSession } = creatorSession

function boardWithTotal(total: number): ScoreBoard {
  return { ...createEmptyScoreBoard(), total }
}

const finishedSnapshot: RoomSnapshot = {
  roomId: hostSession.roomId,
  phase: 'finished',
  players: [
    { playerId: hostSession.you, nickname: '민지', status: 'online' },
    { playerId: 'player-participant', nickname: '지훈', status: 'online' },
    { playerId: 'p3', nickname: '아주긴닉네임입니다', status: 'online' },
  ],
  game: {
    activePlayerId: hostSession.you,
    roundNumber: 12,
    roundDeadline: 0,
    scores: {
      [hostSession.you]: boardWithTotal(198),
      'player-participant': boardWithTotal(214),
      p3: boardWithTotal(176),
    },
  },
}

describe('GameResult', () => {
  it('ranks players by total and highlights my place', () => {
    render(<GameResult session={hostSession} snapshot={finishedSnapshot} />)

    expect(screen.getByRole('heading', { name: '2위' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('게임 종료, 3명 중 2위, 198점')

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('지훈')
    expect(rows[0]).toHaveTextContent('214')
    expect(rows[1]).toHaveTextContent('민지(나)')
  })

  it('lets the host move everyone back to the lobby and anyone leave', async () => {
    const user = userEvent.setup()
    render(<GameResult session={hostSession} snapshot={finishedSnapshot} />)

    expect(screen.getByRole('button', { name: '대기실로' })).toBeEnabled()
    expect(screen.getByText('대기실로 돌아가면 같은 멤버로 다시 시작할 수 있어요')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '나가기' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })

  it('blocks the lobby move for participants', () => {
    render(
      <GameResult
        session={{ ...hostSession, membershipRole: 'participant' }}
        snapshot={finishedSnapshot}
      />,
    )

    expect(screen.getByRole('button', { name: '대기실로' })).toBeDisabled()
    expect(screen.getByText('방장이 대기실로 옮기기를 기다리는 중')).toBeVisible()
  })

  it('opens the full scoresheet in a sheet', async () => {
    const user = userEvent.setup()
    render(<GameResult session={hostSession} snapshot={finishedSnapshot} />)

    await user.click(screen.getByRole('button', { name: '전체 점수표 보기' }))

    const sheet = await screen.findByRole('dialog', { name: '전체 점수표' })
    expect(within(sheet).getByRole('columnheader', { name: '나' })).toBeVisible()
    expect(within(sheet).getAllByRole('rowheader')[0]).toHaveTextContent('Ones')
  })
})
