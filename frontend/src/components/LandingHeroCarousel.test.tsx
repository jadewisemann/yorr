import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { landingGames } from '@/landingGames'
import { LandingHeroCarousel } from './LandingHeroCarousel'

beforeEach(() => {
  // jsdom에는 Pointer Events의 capture API가 없다 — 드래그 핸들러가 이걸 부르므로 스텁해 둔다.
  Element.prototype.setPointerCapture = vi.fn()
})

describe('LandingHeroCarousel', () => {
  it('wide 레이아웃의 화살표로 게임을 넘긴다', () => {
    const onSelect = vi.fn()
    render(
      <LandingHeroCarousel
        activeIndex={0}
        games={landingGames}
        layout="wide"
        onSelect={onSelect}
      />,
    )

    expect(screen.getByRole('button', { name: '이전 게임' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '다음 게임' }))

    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('마지막 게임에서는 다음 버튼이 막힌다', () => {
    render(
      <LandingHeroCarousel
        activeIndex={landingGames.length - 1}
        games={landingGames}
        layout="wide"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '다음 게임' })).toBeDisabled()
  })

  it('화살표 키로 좌우 게임을 넘긴다', () => {
    const onSelect = vi.fn()
    render(
      <LandingHeroCarousel
        activeIndex={1}
        games={landingGames}
        layout="wide"
        onSelect={onSelect}
      />,
    )

    fireEvent.keyDown(screen.getByRole('region', { name: '게임 캐러셀' }), { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenCalledWith(2)

    fireEvent.keyDown(screen.getByRole('region', { name: '게임 캐러셀' }), { key: 'ArrowLeft' })
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('휠을 충분히 돌리면 한 칸 넘어가고, 쿨다운 안에서는 무시한다', () => {
    const onSelect = vi.fn()
    render(
      <LandingHeroCarousel
        activeIndex={1}
        games={landingGames}
        layout="wide"
        onSelect={onSelect}
      />,
    )
    const region = screen.getByRole('region', { name: '게임 캐러셀' })

    fireEvent.wheel(region, { deltaY: 40, timeStamp: 0 })
    expect(onSelect).toHaveBeenCalledWith(2)

    // 쿨다운(340ms) 안의 두 번째 휠은 무시된다.
    fireEvent.wheel(region, { deltaY: 40, timeStamp: 100 })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('작은 휠 움직임은 문턱 아래라 무시한다', () => {
    const onSelect = vi.fn()
    render(
      <LandingHeroCarousel
        activeIndex={1}
        games={landingGames}
        layout="wide"
        onSelect={onSelect}
      />,
    )

    fireEvent.wheel(screen.getByRole('region', { name: '게임 캐러셀' }), {
      deltaY: 5,
      timeStamp: 0,
    })

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('충분히 끌었다 놓으면 옆 게임으로 넘어가고, 조금만 끌면 제자리로 돌아간다', () => {
    const onSelect = vi.fn()
    render(
      <LandingHeroCarousel
        activeIndex={1}
        games={landingGames}
        layout="narrow"
        onSelect={onSelect}
      />,
    )
    const region = screen.getByRole('region', { name: '게임 캐러셀' })

    fireEvent.pointerDown(region, { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(region, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(region, { pointerId: 1 })
    expect(onSelect).toHaveBeenCalledWith(2)

    fireEvent.pointerDown(region, { clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(region, { clientX: 190, pointerId: 1 })
    fireEvent.pointerUp(region, { pointerId: 1 })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
