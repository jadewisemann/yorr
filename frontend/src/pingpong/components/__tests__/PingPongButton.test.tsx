import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PingPongButton } from '@/pingpong/components/PingPongButton'

function classSet(element: HTMLElement) {
  return new Set(element.className.split(/\s+/).filter(Boolean))
}

describe('PingPongButton', () => {
  it('tone 색이 Button ghost 색을 이기고 pressed·focus를 물려받는다', () => {
    render(<PingPongButton onClick={() => {}}>폰 스윙 켜기</PingPongButton>)

    const classes = classSet(screen.getByRole('button'))
    expect(classes).toContain('border-pp-accent/45')
    expect(classes).not.toContain('border-border-ghost')
    expect(classes).toContain('bg-pp-accent/12')
    expect(classes).toContain('pressable')
    expect(classes).toContain('focus-ring')
  })

  it('cta variant는 크기·굵기가 함께 움직인다', () => {
    render(
      <PingPongButton onClick={() => {}} tone="danger" variant="cta">
        READY
      </PingPongButton>,
    )

    const classes = classSet(screen.getByRole('button'))
    expect(classes).toContain('min-h-14')
    expect(classes).toContain('font-black')
    expect(classes).toContain('bg-pp-danger')
    expect(classes).toContain('disabled:bg-surface-veil')
  })

  it('chip variant는 알약이 된다', () => {
    render(
      <PingPongButton onClick={() => {}} variant="chip">
        폰 스윙
      </PingPongButton>,
    )

    const classes = classSet(screen.getByRole('button'))
    expect(classes).toContain('rounded-full')
    expect(classes).toContain('min-h-tap')
  })
})
