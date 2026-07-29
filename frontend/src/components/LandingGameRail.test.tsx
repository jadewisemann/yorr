import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LANDING_PANEL_ID, landingGames, landingTabId } from '@/landingGames'
import { LandingGameRail } from './LandingGameRail'

/** 레일은 부모가 activeIndex를 되돌려 준다는 전제로 동작한다. */
function ControlledRail({ onSelect }: { onSelect?: (index: number) => void }) {
  const [activeIndex, setActiveIndex] = useState(0)
  return (
    <LandingGameRail
      activeIndex={activeIndex}
      games={landingGames}
      onSelect={(index) => {
        setActiveIndex(index)
        onSelect?.(index)
      }}
    />
  )
}

function renderRail(onSelect?: (index: number) => void) {
  render(<ControlledRail {...(onSelect ? { onSelect } : {})} />)
  return { tabs: screen.getAllByRole('tab'), user: userEvent.setup() }
}

/** jsdom에는 레이아웃이 없다. 레일 스크롤 보정을 보려면 좌표를 직접 심는다. */
function stubLayout(railWidth: number, tabWidth: number, gap: number) {
  const rail = screen.getByRole('tablist')
  let scrollLeft = 0
  Object.defineProperty(rail, 'clientWidth', { configurable: true, value: railWidth })
  Object.defineProperty(rail, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (next: number) => {
      scrollLeft = next
    },
  })
  screen.getAllByRole('tab').forEach((tab, index) => {
    Object.defineProperty(tab, 'offsetLeft', {
      configurable: true,
      value: index * (tabWidth + gap),
    })
    Object.defineProperty(tab, 'offsetWidth', { configurable: true, value: tabWidth })
  })
  return rail
}

describe('LandingGameRail', () => {
  it('탭이 어느 영역을 제어하는지 히어로 카피와 연결한다', () => {
    const { tabs } = renderRail()

    expect(tabs).toHaveLength(landingGames.length)
    expect(tabs[0]).toHaveAttribute('aria-controls', LANDING_PANEL_ID)
    expect(tabs[0]).toHaveAttribute('id', landingTabId('yacht'))
  })

  // 탭 목록은 화살표로 오가고 Tab 키로는 하나만 걸린다(WAI-ARIA tabs).
  it('선택된 탭만 tab 순회에 남는다', () => {
    const { tabs } = renderRail()

    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
  })

  it('플레이할 수 없는 게임은 이름 옆에 준비 중을 붙여 읽어 준다', () => {
    renderRail()

    expect(screen.getByRole('tab', { name: /요트 다이스, 1–6인 · 한 판 4–5분$/ })).toBeVisible()
    expect(screen.getByRole('tab', { name: /라이어스 다이스.*, 준비 중$/ })).toBeVisible()
  })

  it('탭을 누르면 그 인덱스를 알린다', async () => {
    const onSelect = vi.fn()
    const { tabs, user } = renderRail(onSelect)

    const second = tabs[1]
    expect(second).not.toBeUndefined()
    if (!second) return
    await user.click(second)

    expect(onSelect).toHaveBeenCalledWith(1)
    expect(second).toHaveAttribute('aria-selected', 'true')
  })

  it('화살표는 양 끝에서 반대편으로 감싸며 포커스를 함께 옮긴다', async () => {
    const { tabs, user } = renderRail()
    const first = tabs[0]
    const last = tabs[tabs.length - 1]
    expect(first).not.toBeUndefined()
    if (!first || !last) return

    first.focus()
    await user.keyboard('{ArrowLeft}')
    expect(last).toHaveFocus()
    expect(last).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowRight}')
    expect(first).toHaveFocus()
    expect(first).toHaveAttribute('aria-selected', 'true')
  })

  it('Home·End로 처음과 끝 탭으로 건너뛴다', async () => {
    const { tabs, user } = renderRail()
    const first = tabs[0]
    const last = tabs[tabs.length - 1]
    if (!first || !last) return

    first.focus()
    await user.keyboard('{End}')
    expect(last).toHaveFocus()

    await user.keyboard('{Home}')
    expect(first).toHaveFocus()
  })

  it('다루지 않는 키는 기본 동작을 가로채지 않는다', async () => {
    const onSelect = vi.fn()
    const { tabs, user } = renderRail(onSelect)
    const first = tabs[0]
    if (!first) return

    first.focus()
    await user.keyboard('{Enter}')
    await user.keyboard('a')

    // Enter는 탭 자신의 클릭으로만 반응하고, 방향키 이동은 일어나지 않는다.
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  // 선택된 칩이 레일 밖에 걸쳐 있으면 어디가 선택됐는지 볼 수 없다.
  it('선택된 탭이 레일 밖이면 레일만 스크롤해 끌어온다', async () => {
    const { tabs, user } = renderRail()
    const rail = stubLayout(300, 100, 20)
    const first = tabs[0]
    if (!first) return

    first.focus()
    await user.keyboard('{End}')
    // 마지막 탭 오른쪽 끝(480+100)에 여백 20을 더한 만큼이 보이도록 민다.
    expect(rail.scrollLeft).toBe(300)

    await user.keyboard('{Home}')
    expect(rail.scrollLeft).toBeLessThan(300)
  })

  it('이미 보이는 탭으로 옮길 때는 레일을 건드리지 않는다', async () => {
    const { tabs, user } = renderRail()
    const rail = stubLayout(1000, 100, 20)
    const first = tabs[0]
    if (!first) return

    first.focus()
    await user.keyboard('{ArrowRight}')

    expect(rail.scrollLeft).toBe(0)
  })
})
