import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RoundTimer } from '@/yacht/components/RoundTimer'

function renderTimer(remainingMs: number, roundNumber = 3) {
  return render(<RoundTimer remainingMs={remainingMs} roundNumber={roundNumber} totalRounds={12} />)
}

describe('RoundTimer', () => {
  it('anchors the round and the remaining time together', () => {
    renderTimer(18_000)

    expect(screen.getByText('라운드 3/12')).toBeVisible()
    expect(screen.getByRole('timer')).toHaveTextContent('0:18')
  })

  it('stays quiet while there is plenty of time', () => {
    renderTimer(18_000)

    expect(screen.getByRole('timer')).not.toHaveTextContent('10초')
    expect(screen.getByText('', { selector: '.sr-only' })).toBeEmptyDOMElement()
  })

  it('announces the ten second warning once per round', () => {
    const { rerender } = renderTimer(9_000)

    const liveRegion = screen.getByText('10초 남았습니다')
    expect(liveRegion).toHaveAttribute('aria-live', 'assertive')

    // 같은 라운드에서 매 tick 다시 읽으면 스크린리더가 막힌다.
    rerender(<RoundTimer remainingMs={8_000} roundNumber={3} totalRounds={12} />)
    expect(screen.getAllByText('10초 남았습니다')).toHaveLength(1)
  })

  it('clears the warning when the next round starts', () => {
    const { rerender } = renderTimer(9_000)
    expect(screen.getByText('10초 남았습니다')).toBeVisible()

    rerender(<RoundTimer remainingMs={30_000} roundNumber={4} totalRounds={12} />)
    expect(screen.queryByText('10초 남았습니다')).not.toBeInTheDocument()
    expect(screen.getByText('라운드 4/12')).toBeVisible()
  })

  it('hides the round pill in compact placements', () => {
    render(<RoundTimer compact remainingMs={18_000} roundNumber={3} totalRounds={12} />)

    expect(screen.queryByText('라운드 3/12')).not.toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('0:18')
  })
})
