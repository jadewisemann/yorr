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

    fireEvent.click(screen.getByRole('button', { name: '다음 게임' }))

    expect(onSelect).toHaveBeenCalledWith(1)
  })

  // 목록이 순환하므로 화살표는 끝에서도 살아 있다 — 점 목록 방향키와 같은 규칙이다.
  it('양 끝에서 반대편으로 감싼다', () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <LandingHeroCarousel
        activeIndex={0}
        games={landingGames}
        layout="wide"
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '이전 게임' }))
    expect(onSelect).toHaveBeenCalledWith(landingGames.length - 1)

    rerender(
      <LandingHeroCarousel
        activeIndex={landingGames.length - 1}
        games={landingGames}
        layout="wide"
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '다음 게임' }))
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  // 스와이프는 발견 가능한 조작이 아니다 — 모바일에도 이동 버튼이 있어야 한다.
  it('좁은 레이아웃에도 화살표를 남긴다', () => {
    const onSelect = vi.fn()
    render(
      <LandingHeroCarousel
        activeIndex={0}
        games={landingGames}
        layout="narrow"
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '다음 게임' }))
    expect(onSelect).toHaveBeenCalledWith(1)
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
