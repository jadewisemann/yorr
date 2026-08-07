import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyScoreBoard } from '@/mocks/fixtures'
import type { ScoreBoard } from '@/realtime/wsEvents'
import { PlayerBadge, ScoreSheet, type ScoreSheetPlayer } from '@/yacht/components/ScoreSheet'
import type { CategoryScores, YachtCategory } from '@/yacht/domain/scoring'

function board(
  categories: Partial<ScoreBoard['categories']> = {},
  totals: Partial<Omit<ScoreBoard, 'categories'>> = {},
): ScoreBoard {
  const empty = createEmptyScoreBoard()
  return { ...empty, ...totals, categories: { ...empty.categories, ...categories } }
}

function renderSheet(options?: {
  activePlayerId?: string | undefined
  candidates?: CategoryScores
  canPick?: boolean
  onPick?: (category: YachtCategory) => void
  players?: ScoreSheetPlayer[]
}) {
  const onPick = options?.onPick ?? vi.fn()
  const players: ScoreSheetPlayer[] = options?.players ?? [
    {
      nickname: '나나',
      playerId: 'me',
      scoreboard: board({ ones: 3, yacht: 0 }, { upperSubtotal: 3, total: 3 }),
    },
    {
      nickname: '지훈',
      playerId: 'p2',
      scoreboard: board({ ones: 2 }, { upperSubtotal: 2, total: 2 }),
    },
  ]
  const view = render(
    <ScoreSheet
      activePlayerId={'activePlayerId' in (options ?? {}) ? options?.activePlayerId : 'me'}
      candidates={options?.candidates ?? {}}
      canPick={options?.canPick ?? false}
      onPick={onPick}
      players={players}
      you="me"
    />,
  )
  return { ...view, onPick, user: userEvent.setup() }
}

describe('ScoreSheet', () => {
  // 스크롤 영역에 포커스 요소가 없을 수 있어 컨테이너가 tab을 받아야 한다(WCAG 2.1.1).
  it('점수표 자체를 키보드로 스크롤할 수 있다', () => {
    renderSheet()

    expect(screen.getByRole('region', { name: '플레이어별 점수표' })).toHaveAttribute(
      'tabindex',
      '0',
    )
  })

  it('미기입 칸과 0점 확정을 구분해 보여 준다', () => {
    renderSheet()

    // 요트는 내가 0점으로 확정했고, 상대는 아직 비어 있다.
    expect(screen.getAllByText('0')).toHaveLength(1)
    // 두 사람 12족보 24칸 중 기록된 3칸을 뺀 나머지가 미기입 표시로 남는다.
    expect(screen.getAllByText('·')).toHaveLength(21)
  })

  it('굴리기 전에는 어떤 행도 기록 버튼이 되지 않는다', () => {
    renderSheet({ canPick: true })

    expect(
      screen.queryAllByRole('button', { name: (name) => name !== '점수 기록 방법' }),
    ).toHaveLength(0)
  })

  it('내 턴에 굴린 뒤에는 미기입 행이 미리보기 점수를 띄운 기록 버튼이 된다', async () => {
    const onPick = vi.fn()
    const { user } = renderSheet({ canPick: true, candidates: { twos: 6, yacht: 50 }, onPick })

    const row = screen.getByRole('button', { name: '듀스 6' })
    await user.click(row)

    expect(onPick).toHaveBeenCalledWith('twos')
    // 이미 0점으로 확정한 요트는 다시 고를 수 없다.
    expect(screen.queryByRole('button', { name: /요트/ })).not.toBeInTheDocument()
  })

  // 굴렸지만 그 족보 점수가 0이어도 "고를 수 있음"은 유지돼야 한다 — 포기 선택지다.
  it('점수가 0인 족보도 기록 대상으로 남는다', () => {
    renderSheet({ canPick: true, candidates: { twos: 6 } })

    expect(screen.getByRole('button', { name: '트레이 0' })).toBeEnabled()
  })

  it('남의 턴이면 미리보기만 뜨고 기록은 막힌다', () => {
    renderSheet({ activePlayerId: 'p2', canPick: true, candidates: { twos: 6 } })

    expect(
      screen.queryAllByRole('button', { name: (name) => name !== '점수 기록 방법' }),
    ).toHaveLength(0)
    expect(screen.getByText('6')).toBeVisible()
  })

  it('내 턴이라도 기록할 수 없는 상태면 행이 버튼이 되지 않는다', () => {
    renderSheet({ canPick: false, candidates: { twos: 6 } })

    expect(
      screen.queryAllByRole('button', { name: (name) => name !== '점수 기록 방법' }),
    ).toHaveLength(0)
  })

  it('턴 주인이 없으면 미리보기 없이 기록된 값만 남는다', () => {
    renderSheet({ activePlayerId: undefined, canPick: true, candidates: { twos: 6 } })

    expect(
      screen.queryAllByRole('button', { name: (name) => name !== '점수 기록 방법' }),
    ).toHaveLength(0)
    expect(screen.queryByText('6')).not.toBeInTheDocument()
  })

  it('소계·보너스·합계를 플레이어별로 합쳐 보여 준다', () => {
    renderSheet({
      players: [
        {
          nickname: '나나',
          playerId: 'me',
          scoreboard: board({}, { upperSubtotal: 70, upperBonus: 35, total: 210 }),
        },
        {
          nickname: '지훈',
          playerId: 'p2',
          scoreboard: board({}, { upperSubtotal: 40, upperBonus: 0, total: 120 }),
        },
      ],
    })

    expect(screen.getByText('소계 / 63')).toBeVisible()
    expect(screen.getByText('70')).toBeVisible()
    expect(screen.getByText('40')).toBeVisible()
    expect(screen.getByText('보너스 +35')).toBeVisible()
    // 보너스를 못 받은 플레이어는 대시로 구분한다.
    expect(screen.getByText('+35')).toBeVisible()
    expect(screen.getByText('—')).toBeVisible()
    expect(screen.getByText('210')).toBeVisible()
    expect(screen.getByText('120')).toBeVisible()
  })

  it('서버가 아직 점수판을 안 준 플레이어도 0으로 자리를 지킨다', () => {
    renderSheet({
      activePlayerId: 'me',
      players: [{ nickname: '나나', playerId: 'me', scoreboard: undefined }],
    })

    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('·')).toHaveLength(12)
  })
})

describe('PlayerBadge', () => {
  it('닉네임 전체를 title로 남겨 머리글자만으로 헷갈리지 않게 한다', () => {
    render(<PlayerBadge nickname="지훈" />)

    expect(screen.getByTitle('지훈')).toHaveTextContent('지훈')
  })

  it('한글은 앞 두 글자, 라틴은 단어 머리글자를 쓴다', () => {
    const { rerender } = render(<PlayerBadge nickname="김민서" />)
    expect(screen.getByTitle('김민서')).toHaveTextContent('김민')

    rerender(<PlayerBadge nickname="ada lovelace" />)
    expect(screen.getByTitle('ada lovelace')).toHaveTextContent('AL')

    rerender(<PlayerBadge active nickname="nova" size="sm" />)
    expect(screen.getByTitle('nova')).toHaveTextContent('N')
  })

  it('머리글자를 못 뽑는 닉네임은 물음표로 대체한다', () => {
    render(<PlayerBadge nickname="" />)

    expect(screen.getByTitle('')).toHaveTextContent('?')
  })
})
