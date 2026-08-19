import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DuelButton } from '@/duel/components/DuelButton'

function classSet(element: HTMLElement) {
  return new Set(element.className.split(/\s+/).filter(Boolean))
}

describe('DuelButton', () => {
  it('tone 색이 Button ghost 색을 이기고 pressed·focus를 물려받는다', () => {
    render(<DuelButton onClick={() => {}}>휘두르기 켜기</DuelButton>)

    const classes = classSet(screen.getByRole('button'))
    expect(classes).toContain('border-duel-signal/50')
    expect(classes).not.toContain('border-border-ghost')
    expect(classes).toContain('text-duel-accent-soft')
    expect(classes).toContain('pressable')
    expect(classes).toContain('focus-ring')
  })

  it('chip variant는 알약, 호출부 blur는 className으로 얹힌다', () => {
    render(
      <DuelButton className="backdrop-blur-md" onClick={() => {}} variant="chip">
        휘두르기
      </DuelButton>,
    )

    const classes = classSet(screen.getByRole('button'))
    expect(classes).toContain('rounded-full')
    expect(classes).toContain('backdrop-blur-md')
  })
})
