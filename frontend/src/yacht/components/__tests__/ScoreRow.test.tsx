import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ScoreRow } from '@/yacht/components/ScoreRow'

describe('ScoreRow', () => {
  it('shows a dash instead of an empty cell before a score exists', () => {
    render(<ScoreRow label="Yacht" />)

    expect(screen.getByText('—')).toBeVisible()
  })

  it('exposes the selected state to assistive tech, not just the border', () => {
    render(<ScoreRow label="Fours" score={12} state="selected" onSelect={vi.fn()} />)

    // 체크 표시는 aria-hidden SVG로 옮겼다 — 접근성 이름에는 '선택'이라는 낱말만 남는다.
    const row = screen.getByRole('button', { name: 'Fours 12 선택' })
    expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(row).toBeEnabled()
  })

  it('labels a used category so it is not distinguished by colour alone', () => {
    render(<ScoreRow label="Ones" score={3} state="used" onSelect={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Ones 3 · 사용됨' })).toBeDisabled()
  })

  it('blocks reselecting a category already recorded as zero', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<ScoreRow label="Yacht" score={0} state="zeroed" onSelect={onSelect} />)

    // 0점 확정은 "지금 굴려서 0점"과 소리로도 구분돼야 한다.
    const row = screen.getByRole('button', { name: 'Yacht 0 · 0점으로 사용됨' })
    expect(row).toBeDisabled()
    await user.click(row)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('is a plain row when it cannot be chosen', () => {
    render(<ScoreRow label="Choice" score={17} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Choice')).toBeVisible()
  })
})
