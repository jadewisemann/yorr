import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gameAt, games } from '@/games'
import { LandingHeroCarousel } from '@/landing/components/LandingHeroCarousel'

beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn()
})

describe('LandingHeroCarousel', () => {
  /** 캐러셀 하나를 그리고, 넘김 요청을 받아 볼 `onSelect`를 함께 돌려준다. */
  function renderCarousel(options: { activeIndex?: number; layout?: 'narrow' | 'wide' } = {}) {
    const onSelect = vi.fn()
    const view = render(
      <LandingHeroCarousel
        activeIndex={options.activeIndex ?? 0}
        games={games}
        layout={options.layout ?? 'wide'}
        onPlay={vi.fn()}
        onSelect={onSelect}
      />,
    )
    return {
      ...view,
      onSelect,
      region: () => screen.getByRole('region', { name: '게임 캐러셀' }),
    }
  }

  it('wide 레이아웃의 화살표로 게임을 넘긴다', () => {
    const { onSelect } = renderCarousel()

    fireEvent.click(screen.getByRole('button', { name: '다음 게임' }))

    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('양 끝에서 반대편으로 감싼다', () => {
    const { onSelect, rerender } = renderCarousel()

    fireEvent.click(screen.getByRole('button', { name: '이전 게임' }))
    expect(onSelect).toHaveBeenCalledWith(games.length - 1)

    rerender(
      <LandingHeroCarousel
        activeIndex={games.length - 1}
        games={games}
        layout="wide"
        onPlay={vi.fn()}
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '다음 게임' }))
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('wide에서는 양옆 이웃 카드를 눌러 바로 그 게임으로 넘어간다', () => {
    const { onSelect } = renderCarousel()

    fireEvent.click(screen.getByRole('button', { name: `${gameAt(1).name} 선택` }))
    expect(onSelect).toHaveBeenCalledWith(1)

    fireEvent.click(screen.getByRole('button', { name: `${gameAt(games.length - 1).name} 선택` }))
    expect(onSelect).toHaveBeenCalledWith(games.length - 1)
  })

  it('narrow의 이웃 카드는 누를 수 있는 물건이 아니다', () => {
    renderCarousel({ layout: 'narrow' })

    expect(screen.queryByRole('button', { name: /선택$/ })).not.toBeInTheDocument()
  })

  it('좁은 레이아웃에도 화살표를 남긴다', () => {
    const { onSelect } = renderCarousel({ layout: 'narrow' })

    fireEvent.click(screen.getByRole('button', { name: '다음 게임' }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('화살표 키로 좌우 게임을 넘긴다', () => {
    const { onSelect, region } = renderCarousel({ activeIndex: 1 })

    fireEvent.keyDown(region(), { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenCalledWith(2)

    fireEvent.keyDown(region(), { key: 'ArrowLeft' })
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('휠을 충분히 돌리면 한 칸 넘어가고, 쿨다운 안에서는 무시한다', () => {
    const { onSelect, region } = renderCarousel({ activeIndex: 1 })
    const stage = region()

    fireEvent.wheel(stage, { deltaY: 40, timeStamp: 0 })
    expect(onSelect).toHaveBeenCalledWith(2)

    fireEvent.wheel(stage, { deltaY: 40, timeStamp: 100 })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('작은 휠 움직임은 문턱 아래라 무시한다', () => {
    const { onSelect, region } = renderCarousel({ activeIndex: 1 })

    fireEvent.wheel(region(), {
      deltaY: 5,
      timeStamp: 0,
    })

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('충분히 끌었다 놓으면 옆 게임으로 넘어가고, 조금만 끌면 제자리로 돌아간다', () => {
    const { onSelect, region } = renderCarousel({ activeIndex: 1, layout: 'narrow' })
    const stage = region()

    fireEvent.pointerDown(stage, { buttons: 1, clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(stage, { buttons: 1, clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(stage, { pointerId: 1 })
    expect(onSelect).toHaveBeenCalledWith(2)

    fireEvent.pointerDown(stage, { buttons: 1, clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(stage, { buttons: 1, clientX: 190, pointerId: 1 })
    fireEvent.pointerUp(stage, { pointerId: 1 })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('CTA 위에서 살짝 흔들린 탭은 드래그로 뒤집히지 않는다', () => {
    const onPlay = vi.fn()
    const onSelect = vi.fn()
    render(
      <LandingHeroCarousel
        activeIndex={0}
        games={games}
        layout="narrow"
        onPlay={onPlay}
        onSelect={onSelect}
      />,
    )
    const region = screen.getByRole('region', { name: '게임 캐러셀' })
    const play = screen.getByRole('button', { name: /플레이$/ })

    fireEvent.pointerDown(play, { buttons: 1, clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(region, { buttons: 1, clientX: 204, pointerId: 1 })
    fireEvent.pointerUp(region, { pointerId: 1 })
    fireEvent.click(play, { detail: 1 })
    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.pointerDown(play, { buttons: 1, clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(region, { buttons: 1, clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(region, { pointerId: 1 })
    fireEvent.click(play, { detail: 1 })
    expect(onSelect).toHaveBeenCalledWith(1)
    expect(onPlay).toHaveBeenCalledTimes(1)
  })
})
