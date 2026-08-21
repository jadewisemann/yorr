import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HeroArt, heroArtSrc } from '@/landing/components/HeroArt'

describe('HeroArt', () => {
  it('스크린리더에서 감춘 순수 장식으로 렌더한다', () => {
    const view = render(<HeroArt game="yacht" layout="wide" />)

    const wrapper = view.container.firstElementChild
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true')
    expect(wrapper?.querySelector('img')?.getAttribute('alt')).toBe('')
  })

  it('게임·레이아웃별 베이크 에셋을 가리킨다', () => {
    const view = render(<HeroArt game="duel" layout="narrow" />)

    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(
      heroArtSrc('duel', 'narrow'),
    )
  })

  it('게임이 바뀌면 그 게임의 에셋으로 갈아탄다', () => {
    const view = render(<HeroArt game="yacht" layout="wide" />)

    view.rerender(<HeroArt game="fishing" layout="wide" />)

    expect(view.container.querySelector('img')?.getAttribute('src')).toBe(
      heroArtSrc('fishing', 'wide'),
    )
  })
})
