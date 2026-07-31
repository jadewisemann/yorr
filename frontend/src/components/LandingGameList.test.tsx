import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LANDING_PANEL_ID, landingGames, landingTabId } from '@/landingGames'
import { LandingGameList } from './LandingGameList'

function ControlledList({ onSelect }: { onSelect?: (index: number) => void }) {
  const [activeIndex, setActiveIndex] = useState(0)
  return (
    <LandingGameList
      activeIndex={activeIndex}
      games={landingGames}
      onSelect={(index) => {
        setActiveIndex(index)
        onSelect?.(index)
      }}
    />
  )
}

function renderList(onSelect?: (index: number) => void) {
  render(<ControlledList {...(onSelect ? { onSelect } : {})} />)
  return { tabs: screen.getAllByRole('tab'), user: userEvent.setup() }
}

describe('LandingGameList', () => {
  it('전체 개수와 공개된 개수를 함께 알려 준다', () => {
    renderList()

    const liveCount = landingGames.filter((game) => game.live).length
    expect(screen.getByText(`${landingGames.length}개 중 ${liveCount}개 공개`)).toBeVisible()
  })

  it('세로 목록임을 보조기술에 알린다', () => {
    renderList()

    const tablist = screen.getByRole('tablist', { name: '게임 선택' })
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('각 행이 히어로 카피 영역을 제어하는 탭이다', () => {
    const { tabs } = renderList()

    expect(tabs).toHaveLength(landingGames.length)
    expect(tabs[0]).toHaveAttribute('aria-controls', LANDING_PANEL_ID)
    expect(tabs[0]).toHaveAttribute('id', landingTabId('yacht'))
  })

  it('선택된 행만 tab 순회에 남는다', () => {
    const { tabs } = renderList()

    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')
  })

  // 상태 배지는 색 점만 두면 흑백에서 구분되지 않는다 — 문구를 함께 쓴다.
  it('공개 여부를 문구로 구분한다', () => {
    renderList()

    expect(screen.getByText('플레이 가능')).toBeVisible()
    expect(screen.getAllByText('공개 예정')).toHaveLength(landingGames.length - 1)
  })

  it('번호는 두 자리로 맞춰 붙인다', () => {
    renderList()

    expect(screen.getByText('01')).toBeVisible()
    expect(screen.getByText('05')).toBeVisible()
  })

  it('행을 누르면 그 인덱스를 알린다', async () => {
    const onSelect = vi.fn()
    const { tabs, user } = renderList(onSelect)

    const third = tabs[2]
    if (!third) return
    await user.click(third)

    expect(onSelect).toHaveBeenCalledWith(2)
    expect(third).toHaveAttribute('aria-selected', 'true')
  })

  // 방향키로 옮긴 뒤 포커스가 tabindex="-1" 행에 남으면 이후 Tab이 목록을 벗어난다.
  it('위아래 화살표가 선택과 포커스를 함께 옮기고 양 끝에서 감싼다', async () => {
    const { tabs, user } = renderList()
    const first = tabs[0]
    const last = tabs[tabs.length - 1]
    if (!first || !last) return

    first.focus()
    await user.keyboard('{ArrowUp}')
    expect(last).toHaveFocus()
    expect(last).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(first).toHaveFocus()
    expect(first).toHaveAttribute('aria-selected', 'true')
  })

  it('Home·End로 처음과 끝 행으로 건너뛴다', async () => {
    const { tabs, user } = renderList()
    const first = tabs[0]
    const last = tabs[tabs.length - 1]
    if (!first || !last) return

    first.focus()
    await user.keyboard('{End}')
    expect(last).toHaveFocus()

    await user.keyboard('{Home}')
    expect(first).toHaveFocus()
  })

  it('다루지 않는 키에서는 방향 이동이 일어나지 않는다', async () => {
    const onSelect = vi.fn()
    const { tabs, user } = renderList(onSelect)
    const first = tabs[0]
    if (!first) return

    first.focus()
    await user.keyboard('{Escape}')

    expect(onSelect).not.toHaveBeenCalled()
    expect(first).toHaveFocus()
  })
})
