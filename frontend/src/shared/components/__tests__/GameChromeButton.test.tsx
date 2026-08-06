import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GameChromeButton } from '../GameChromeButton'

function classSet(element: HTMLElement) {
  return new Set(element.className.split(/\s+/).filter(Boolean))
}

describe('GameChromeButton', () => {
  /**
   * 이 단정이 이 파일의 존재 이유다. tone이 주는 색은 Button의 ghost variant 색을
   * tailwind-merge로 이겨야 한다. 이기지 못하면 border-white/15와 border-white/28이 둘 다
   * 살아남아 승자를 빌드된 CSS 선언 순서가 정하고, 화면은 조용히 ghost 색으로 그려진다.
   */
  it('tone 색이 Button ghost variant 색을 이긴다', () => {
    render(<GameChromeButton onClick={() => {}}>나가기</GameChromeButton>)

    const classes = classSet(screen.getByRole('button'))
    expect(classes).toContain('border-white/15')
    expect(classes).not.toContain('border-white/28')
    expect(classes).toContain('bg-surface-veil')
    expect(classes).not.toContain('bg-transparent')
    expect(classes).toContain('text-white/70')
    expect(classes).not.toContain('text-content')
  })

  it('overlay tone은 스크림과 블러를 얹는다', () => {
    render(
      <GameChromeButton className="absolute top-20 left-4 z-20" onClick={() => {}} tone="overlay">
        방 닫기
      </GameChromeButton>,
    )

    const classes = classSet(screen.getByRole('button'))
    expect(classes).toContain('bg-black/45')
    expect(classes).toContain('backdrop-blur-md')
    expect(classes).toContain('border-white/20')
    // 호출부가 준 배치는 살아남는다.
    expect(classes).toContain('absolute')
    expect(classes).toContain('top-20')
  })

  /** 이 일곱 자리가 원래 갖지 못했던 것들 — 규칙 5(pressed·focus·tap 크기)를 Button에서 받는다. */
  it('pressed·focus-ring·탭 하한을 Button에서 물려받는다', () => {
    render(<GameChromeButton onClick={() => {}}>나가기</GameChromeButton>)

    const classes = classSet(screen.getByRole('button'))
    // 눌림은 recipes.css의 pressable이 들고 있다 — Button이 값을 직접 적지 않는다.
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
