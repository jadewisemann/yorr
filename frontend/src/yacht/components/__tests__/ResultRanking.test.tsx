import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { type RankedPlayer, ResultRanking } from '@/yacht/components/ResultRanking'

const players: RankedPlayer[] = [
  { nickname: '지훈', playerId: 'p2', total: 214 },
  { nickname: '나나', playerId: 'me', total: 198 },
  { nickname: '민서', playerId: 'p3', total: 140 },
]

describe('ResultRanking', () => {
  it('서버가 준 순서 그대로 등수를 붙인다', () => {
    render(<ResultRanking players={players} you="me" />)

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.textContent?.startsWith('1') || false)).toEqual([
      true,
      false,
      false,
    ])
    expect(rows[1]).toHaveTextContent('2')
    expect(rows[2]).toHaveTextContent('3')
  })

  // 색·테두리만으로 1위와 내 자리를 구분하면 흑백·저시력에서 읽히지 않는다.
  it('1위와 내 자리를 텍스트 라벨로도 구분한다', () => {
    render(<ResultRanking players={players} you="me" />)

    const [winnerRow, myRow, otherRow] = screen.getAllByRole('listitem')
    expect(winnerRow).not.toBeUndefined()
    expect(myRow).not.toBeUndefined()
    if (!winnerRow || !myRow || !otherRow) return

    expect(within(winnerRow).getByText('WIN')).toBeVisible()
    expect(within(winnerRow).queryByText('(나)')).not.toBeInTheDocument()
    expect(within(myRow).getByText('(나)')).toBeVisible()
    expect(within(myRow).queryByText('WIN')).not.toBeInTheDocument()
    expect(within(otherRow).queryByText('(나)')).not.toBeInTheDocument()
  })

  it('내가 1위면 두 라벨이 함께 붙는다', () => {
    render(<ResultRanking players={players} you="p2" />)

    const winnerRow = screen.getAllByRole('listitem')[0]
    expect(winnerRow).not.toBeUndefined()
    if (!winnerRow) return
    expect(within(winnerRow).getByText('(나)')).toBeVisible()
    expect(within(winnerRow).getByText('WIN')).toBeVisible()
  })

  it('총점을 등수마다 함께 보여 준다', () => {
    render(<ResultRanking className="mt-4" players={players} you="me" />)

    expect(screen.getByText('214')).toBeVisible()
    expect(screen.getByText('198')).toBeVisible()
    expect(screen.getByText('140')).toBeVisible()
  })

  it('참가자가 없으면 빈 목록으로 남는다', () => {
    render(<ResultRanking players={[]} you="me" />)

    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
