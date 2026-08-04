import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { games } from '@/games'
import { LandingHeroCarousel } from '@/landing/components/LandingHeroCarousel'

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
        games={games}
        layout="wide"
        onPartyMode={vi.fn()}
        onPlay={vi.fn()}
        onSelect={onSelect}
        onTutorial={vi.fn()}
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
        games={games}
        layout="wide"
        onPartyMode={vi.fn()}
        onPlay={vi.fn()}
        onSelect={onSelect}
        onTutorial={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '이전 게임' }))
    expect(onSelect).toHaveBeenCalledWith(games.length - 1)

    rerender(
      <LandingHeroCarousel
        activeIndex={games.length - 1}
        games={games}
        layout="wide"
        onPartyMode={vi.fn()}
        onPlay={vi.fn()}
        onSelect={onSelect}
        onTutorial={vi.fn()}
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
        games={games}
        layout="narrow"
        onPartyMode={vi.fn()}
        onPlay={vi.fn()}
        onSelect={onSelect}
        onTutorial={vi.fn()}
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
        games={games}
        layout="wide"
        onPartyMode={vi.fn()}
        onPlay={vi.fn()}
        onSelect={onSelect}
        onTutorial={vi.fn()}
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
        games={games}
        layout="wide"
        onPartyMode={vi.fn()}
        onPlay={vi.fn()}
        onSelect={onSelect}
        onTutorial={vi.fn()}
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
        games={games}
        layout="wide"
        onPartyMode={vi.fn()}
        onPlay={vi.fn()}
        onSelect={onSelect}
        onTutorial={vi.fn()}
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
        games={games}
        layout="narrow"
        onPartyMode={vi.fn()}
        onPlay={vi.fn()}
        onSelect={onSelect}
        onTutorial={vi.fn()}
      />,
    )
    const region = screen.getByRole('region', { name: '게임 캐러셀' })

    // buttons: 1 = 아직 누른 채로 움직이는 중. 카드 안 플레이 CTA가 생기면서 드래그는
    // pointerdown이 아니라 8px을 넘긴 순간 시작되고, 그때까지 캡처를 걸지 않는다 —
    // 캡처 없이 영역 밖에서 손을 떼면 pointerup이 안 오므로 buttons로 그 흔적을 정리한다.
    fireEvent.pointerDown(region, { buttons: 1, clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(region, { buttons: 1, clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(region, { pointerId: 1 })
    expect(onSelect).toHaveBeenCalledWith(2)

    fireEvent.pointerDown(region, { buttons: 1, clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(region, { buttons: 1, clientX: 190, pointerId: 1 })
    fireEvent.pointerUp(region, { pointerId: 1 })
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
        onPartyMode={vi.fn()}
        onPlay={onPlay}
        onSelect={onSelect}
        onTutorial={vi.fn()}
      />,
    )
    const region = screen.getByRole('region', { name: '게임 캐러셀' })
    const play = screen.getByRole('button', { name: /플레이$/ })

    // 임계값(8px) 아래로 움직인 탭 — 캡처를 걸지 않으므로 click이 버튼에 그대로 닿는다.
    fireEvent.pointerDown(play, { buttons: 1, clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(region, { buttons: 1, clientX: 204, pointerId: 1 })
    fireEvent.pointerUp(region, { pointerId: 1 })
    fireEvent.click(play, { detail: 1 })
    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()

    // CTA 위에서 시작한 스와이프는 칸을 넘기고, 뒤따르는 click은 삼킨다.
    fireEvent.pointerDown(play, { buttons: 1, clientX: 200, pointerId: 1 })
    fireEvent.pointerMove(region, { buttons: 1, clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(region, { pointerId: 1 })
    fireEvent.click(play, { detail: 1 })
    expect(onSelect).toHaveBeenCalledWith(1)
    expect(onPlay).toHaveBeenCalledTimes(1)
  })
})
