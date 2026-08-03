import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createEmptyScoreBoard } from '@/mocks/fixtures'
import type { ScoreBoard } from '@/realtime/wsEvents'
import { ScoreMatrix } from '@/yacht/components/ScoreMatrix'

function board(overrides: Partial<ScoreBoard['categories']>, total = 0): ScoreBoard {
  const empty = createEmptyScoreBoard()
  return { ...empty, categories: { ...empty.categories, ...overrides }, total }
}

const players = [
  { nickname: '나', playerId: 'me', scoreboard: board({ ones: 3, yacht: 0 }, 3) },
  { nickname: '지훈', playerId: 'p2', scoreboard: board({ ones: 2 }, 2) },
]

describe('ScoreMatrix', () => {
  it('puts every player in a column with mine first', () => {
    render(<ScoreMatrix players={players} />)

    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual(['족보', '나', '지훈'])
  })

  it('writes a dash for a blank cell rather than leaving it empty', () => {
    render(<ScoreMatrix players={players} />)

    const row = screen.getByRole('rowheader', { name: /듀스/ }).closest('tr')
    expect(row).not.toBeNull()
    if (!row) return
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['—', '—'])
  })

  it('keeps a recorded zero distinct from a blank', () => {
    render(<ScoreMatrix players={players} />)

    const row = screen.getByRole('rowheader', { name: /요트/ }).closest('tr')
    expect(row).not.toBeNull()
    if (!row) return
    const [mine, theirs] = within(row).getAllByRole('cell')
    expect(mine).toHaveTextContent('0')
    expect(theirs).toHaveTextContent('—')
  })

  it('totals each player in the footer', () => {
    render(<ScoreMatrix players={players} />)

    const footerRow = screen.getByRole('rowheader', { name: '합계' }).closest('tr')
    expect(footerRow).not.toBeNull()
    if (!footerRow) return
    expect(
      within(footerRow)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['3', '2'])
  })

  it('falls back to zeroes for a player the server has not scored yet', () => {
    render(<ScoreMatrix players={[{ nickname: '나', playerId: 'me', scoreboard: undefined }]} />)

    const footerRow = screen.getByRole('rowheader', { name: '합계' }).closest('tr')
    expect(footerRow).not.toBeNull()
    if (!footerRow) return
    expect(within(footerRow).getByRole('cell')).toHaveTextContent('0')
  })
})
