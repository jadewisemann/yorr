import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GameChromeButton } from '../GameChromeButton'

function classSet(element: HTMLElement) {
  return new Set(element.className.split(/\s+/).filter(Boolean))
}

describe('GameChromeButton', () => {
  it('tone 색이 Button ghost variant 색을 이긴다', () => {
    render(<GameChromeButton onClick={() => {}}>나가기</GameChromeButton>)

    const classes = classSet(screen.getByRole('button'))
    expect(classes).toContain('border-border-raised')
    expect(classes).not.toContain('border-border-ghost')
    expect(classes).toContain('bg-surface-veil')
    expect(classes).not.toContain('bg-transparent')
    expect(classes).toContain('text-content-muted')
    expect(classes).not.toContain('text-content')
  })

  it('overlay tone은 스크림과 블러를 얹는다', () => {
    render(
      <GameChromeButton className="absolute top-20 left-4 z-20" onClick={() => {}} tone="overlay">
        방 닫기
      </GameChromeButton>,
    )

    const classes = classSet(screen.getByRole('button'))
    expect(classes).toContain('bg-scrim-soft')
    expect(classes).toContain('backdrop-blur-md')
    expect(classes).toContain('border-border-strong')
    expect(classes).toContain('absolute')
    expect(classes).toContain('top-20')
  })

  it('pressed·focus-ring·탭 하한을 Button에서 물려받는다', () => {
    render(<GameChromeButton onClick={() => {}}>나가기</GameChromeButton>)

    const classes = classSet(screen.getByRole('button'))
    expect(classes).toContain('pressable')
    expect(classes).toContain('focus-ring')
    expect(classes).toContain('min-h-tap')
    expect(classes).toContain('rounded-full')
  })

  it('굵기는 본문 굵기를 유지한다(Button 기본값 bold로 올라가지 않는다)', () => {
    render(<GameChromeButton onClick={() => {}}>나가기</GameChromeButton>)

    const classes = classSet(screen.getByRole('button'))
    expect(classes).toContain('font-normal')
    expect(classes).not.toContain('font-bold')
  })
})
