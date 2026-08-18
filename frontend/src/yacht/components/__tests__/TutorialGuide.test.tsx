import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TutorialGuide } from '@/yacht/components/TutorialGuide'

const ROWS_ID = 'fake-score-rows'

function mountCategoryRows(rects: Record<string, FakeRect>) {
  for (const [category, rect] of Object.entries(rects)) {
    const row = targetHolder().appendChild(document.createElement('div'))
    row.dataset.tutorialCategory = category
    row.getBoundingClientRect = () => domRect(rect)
  }
}

function mountTutorialTarget(name: string, rect: FakeRect) {
  const el = targetHolder().appendChild(document.createElement('div'))
  el.dataset.tutorial = name
  el.getBoundingClientRect = () => domRect(rect)
}

interface FakeRect {
  top: number
  left: number
  width: number
  height: number
}

function domRect({ top, left, width, height }: FakeRect): DOMRect {
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function targetHolder() {
  const existing = document.getElementById(ROWS_ID)
  if (existing) return existing
  const holder = document.createElement('div')
  holder.id = ROWS_ID
  document.body.append(holder)
  return holder
}

function blockers() {
  const host = document.querySelector('[role="presentation"]')
  if (!host) throw new Error('안내 오버레이를 찾을 수 없습니다')
  return [...host.children]
    .filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.className.includes('pointer-events-auto') &&
        !child.className.includes('rounded-card'),
    )
    .map((pane) => ({
      dimmed: pane.className.includes('bg-scrim-strong'),
      blocks: pane.className.includes('pointer-events-auto'),
    }))
}

function halo() {
  const ring = document.querySelector('[class*="animate-tutorial-halo"]')
  if (!(ring instanceof HTMLElement)) throw new Error('강조 링을 찾을 수 없습니다')
  const px = (value: string) => Number.parseFloat(value)
  return {
    top: px(ring.style.top),
    left: px(ring.style.left),
    width: px(ring.style.width),
    height: px(ring.style.height),
  }
}

afterEach(() => {
  document.getElementById(ROWS_ID)?.remove()
})

const AFTER_FIRST_ROLL = { ones: 1, choice: 22, sixes: 12 }
const AFTER_SECOND_ROLL = { ones: 1, choice: 23, sixes: 18 }
const AFTER_LAST_ROLL = {
  ones: 0,
  choice: 26,
  sixes: 24,
  fourOfAKind: 26,
  fullHouse: 0,
  smallStraight: 0,
  largeStraight: 0,
  yacht: 0,
}

const baseProps = {
  candidates: AFTER_FIRST_ROLL,
  keptValues: [] as number[],
  motionNoticeVisible: true,
  rollCount: 0,
  rolled: false,
  rolling: false,
  submitted: false,
  wide: false,
}

const setup = (props: Partial<Parameters<typeof TutorialGuide>[0]> = {}) => {
  const onClose = vi.fn()
  const view = render(<TutorialGuide {...baseProps} onClose={onClose} {...props} />)
  return { ...view, onClose, user: userEvent.setup() }
}

const heading = () => screen.getByRole('heading', { level: 2 }).textContent

const atKeepAgain = {
  candidates: AFTER_SECOND_ROLL,
  keptValues: [6, 6],
  rollCount: 2,
  rolled: true,
}

const atLastRoll = {
  candidates: AFTER_SECOND_ROLL,
  keptValues: [6, 6, 6],
  rollCount: 2,
  rolled: true,
}

const atRecord = {
  candidates: AFTER_LAST_ROLL,
  keptValues: [6, 6, 6, 6],
  rollCount: 3,
  rolled: true,
}

const AFTER_RECORD = {
  ones: 0,
  twos: 2,
  threes: 0,
  fours: 0,
  fives: 0,
  sixes: 24,
  choice: 26,
  fullHouse: 0,
  smallStraight: 0,
  largeStraight: 0,
  yacht: 0,
}

const atHandTour = {
  candidates: AFTER_RECORD,
  keptValues: [6, 6, 6, 6],
  rollCount: 3,
  rolled: true,
  submitted: true,
}

describe('TutorialGuide', () => {
  it('굴림 → 선택을 두 번 되풀이하고 마지막 굴림까지 끝내면 기록으로 간다', async () => {
    const { rerender, user } = setup()

    expect(heading()).toBe('요트 다이스가 처음이신가요?')
    await user.click(screen.getByRole('button', { name: '시작하기' }))
    expect(heading()).toBe('먼저 주사위를 굴려요')

    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} rollCount={1} rolled />)
    expect(heading()).toBe('6이 2개 나왔어요')

    rerender(
      <TutorialGuide {...baseProps} keptValues={[6, 6]} onClose={vi.fn()} rollCount={1} rolled />,
    )
    expect(heading()).toBe('나머지만 다시 굴려요')

    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atKeepAgain} />)
    expect(heading()).toBe('6이 3개로 늘었어요')

    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atLastRoll} />)
    expect(heading()).toBe('이제 마지막 한 번이 남았어요')
    await user.click(screen.getByRole('button', { name: '흔들어서 던지기' }))
    expect(heading()).toBe('폰을 흔들어서 던져요')

    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atRecord} />)
    expect(heading()).toBe('6이 4개 — 이건 포커예요!')

    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atHandTour} />)
    expect(heading()).toBe('에이스')
  })

  it('두 번째 던지기가 날아가는 동안에는 단계를 옮기지 않는다', () => {
    const { rerender } = setup({ keptValues: [6, 6], rollCount: 1, rolled: true })
    expect(heading()).toBe('나머지만 다시 굴려요')

    rerender(
      <TutorialGuide
        {...baseProps}
        keptValues={[6, 6]}
        onClose={vi.fn()}
        rollCount={2}
        rolled
        rolling
      />,
    )
    expect(heading()).toBe('나머지만 다시 굴려요')

    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atKeepAgain} />)
    expect(heading()).toBe('6이 3개로 늘었어요')
  })

  it('주사위가 날아가는 동안에는 백드롭을 걷어 굴러가는 주사위가 보이게 한다', () => {
    setup({ keptValues: [6, 6], rollCount: 2, rolled: true, rolling: true })

    expect(blockers()).toHaveLength(0)
  })

  it('두 번째 선택을 마치지 않으면 마지막 굴림으로 넘어가지 않는다', () => {
    const { rerender } = setup({ keptValues: [6, 6], rollCount: 1, rolled: true })
    expect(heading()).toBe('나머지만 다시 굴려요')

    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atKeepAgain} />)

    expect(heading()).toBe('6이 3개로 늘었어요')
    expect(screen.getByRole('status')).toHaveTextContent('새로 나온 6 1개도 탭해서 킵해 보세요')
  })

  it('6을 하나만 킵하면 넘어가지 않고 몇 개 남았는지 알려 준다', () => {
    const { rerender } = setup({ keptValues: [6], rollCount: 1, rolled: true })

    expect(heading()).toBe('좋아요, 1개 남았어요')

    rerender(
      <TutorialGuide {...baseProps} keptValues={[6, 6]} onClose={vi.fn()} rollCount={1} rolled />,
    )
    expect(heading()).toBe('나머지만 다시 굴려요')
  })

  it('6이 아닌 주사위를 킵하면 풀라고 알려 준다', () => {
    setup({ keptValues: [6, 3], rollCount: 1, rolled: true })

    expect(heading()).toBe('6이 아닌 주사위를 킵했어요')
    expect(screen.getByRole('status')).toHaveTextContent('한 번 더 탭하면 킵이 풀려요')
  })

  it('선택이 끝나면 지시하지 않고 어떻게 던질지 먼저 묻는다', async () => {
    const { user } = setup(atLastRoll)

    expect(heading()).toBe('이제 마지막 한 번이 남았어요')
    expect(screen.getByRole('button', { name: '흔들어서 던지기' })).toBeVisible()
    expect(screen.getByRole('button', { name: '버튼으로 던지기' })).toBeVisible()
    expect(screen.getByRole('status')).not.toHaveTextContent('흔들기')

    await user.click(screen.getByRole('button', { name: '버튼으로 던지기' }))
    expect(heading()).toBe('마지막 한 번 남았어요')
  })

  it('흔들기를 골랐다가도 버튼으로 되돌릴 수 있다', async () => {
    const { user } = setup(atLastRoll)

    await user.click(screen.getByRole('button', { name: '흔들어서 던지기' }))
    expect(heading()).toBe('폰을 흔들어서 던져요')

    await user.click(screen.getByRole('button', { name: '버튼으로 던질게요' }))
    expect(heading()).toBe('마지막 한 번 남았어요')
  })

  it('센서가 없는 기기에서는 묻지 않고 한 갈래로만 안내한다', async () => {
    const { user } = setup({ ...atLastRoll, motionNoticeVisible: false })

    expect(heading()).toBe('이제 마지막 한 번이 남았어요')
    expect(screen.queryByRole('button', { name: '흔들어서 던지기' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '던져 볼게요' }))
    expect(heading()).toBe('마지막 한 번 남았어요')
  })

  it('안내보다 빨리 세 번을 다 굴려 버렸으면 흔들기를 건너뛰고 기록으로 간다', () => {
    setup(atRecord)

    expect(heading()).toBe('6이 4개 — 이건 포커예요!')
  })

  it('식스보다 높은 포커를 짚어 주고 두 점수를 비교해 준다', () => {
    setup(atRecord)

    const body = screen.getByRole('status')
    expect(body).toHaveTextContent('같은 눈이 4개 모이면 포커')
    expect(body).toHaveTextContent('26점')
    expect(body).toHaveTextContent('식스에 적는 24점보다 높아요')
  })

  it('눌러야 넘어가는 단계에는 버튼 대신 어디를 누를지 알려 준다', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: '시작하기' }))

    expect(screen.getByText('표시된 곳을 눌러 보세요')).toBeVisible()
  })

  it('족보를 다른 곳으로 넘기지 않고 한 칸씩 말풍선으로 설명한다', async () => {
    const { user } = setup(atHandTour)

    expect(screen.getByText('남은 족보 둘러보기 · 1 / 12')).toBeVisible()
    expect(heading()).toBe('에이스')
    expect(screen.getByRole('status')).not.toHaveTextContent('도움말')

    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('남은 족보 둘러보기 · 2 / 12')).toBeVisible()
    expect(heading()).toBe('듀스')
  })

  it('보너스 설명이 위 여섯 칸 직후, 특수 족보 직전에 들어간다', async () => {
    const { user } = setup(atHandTour)

    for (let page = 0; page < 6; page += 1) {
      await user.click(screen.getByRole('button', { name: '다음' }))
    }
    expect(heading()).toBe('위 칸 보너스')
    expect(screen.getByRole('status')).toHaveTextContent('63점을 넘으면 보너스 35점')

    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(heading()).toBe('초이스')
  })

  it('보너스 장은 위 여섯 칸을 한 덩어리로 감싸 짚는다', async () => {
    mountCategoryRows({
      ones: { top: 100, left: 700, width: 280, height: 40 },
      twos: { top: 140, left: 700, width: 280, height: 40 },
      threes: { top: 180, left: 700, width: 280, height: 40 },
      fours: { top: 220, left: 700, width: 280, height: 40 },
      fives: { top: 260, left: 700, width: 280, height: 40 },
      sixes: { top: 300, left: 700, width: 280, height: 40 },
      yacht: { top: 500, left: 700, width: 280, height: 40 },
    })
    const { user } = setup(atHandTour)

    expect(halo()).toEqual({ top: 94, left: 694, width: 292, height: 52 })

    for (let page = 0; page < 6; page += 1) {
      await user.click(screen.getByRole('button', { name: '다음' }))
    }
    expect(heading()).toBe('위 칸 보너스')

    expect(halo()).toEqual({ top: 94, left: 694, width: 292, height: 252 })
  })

  it('에이스·듀스 같은 위 칸도 묶지 않고 하나씩 설명한다', async () => {
    const { user } = setup(atHandTour)

    const upper = ['에이스', '듀스', '트레이', '포', '파이브', '식스']
    for (const [index, label] of upper.entries()) {
      expect(heading()).toBe(label)
      if (index < upper.length - 1) await user.click(screen.getByRole('button', { name: '다음' }))
    }
  })

  it('족보를 설명하는 동안 점수표의 그 칸을 짚고, 넘기면 다음 칸으로 옮겨간다', async () => {
    mountCategoryRows({
      ones: { top: 100, left: 20, width: 200, height: 40 },
      twos: { top: 150, left: 20, width: 200, height: 40 },
    })
    const { user } = setup(atHandTour)

    expect(heading()).toBe('에이스')
    expect(halo()).toEqual({ top: 94, left: 14, width: 212, height: 52 })

    await user.click(screen.getByRole('button', { name: '다음' }))

    expect(heading()).toBe('듀스')
    expect(halo()).toEqual({ top: 144, left: 14, width: 212, height: 52 })
  })

  it('주사위 단계는 구멍 주변을 덮고, 점수표 단계는 덮지 않는다', () => {
    mountTutorialTarget('tray', { top: 100, left: 10, width: 350, height: 300 })
    mountCategoryRows({ fourOfAKind: { top: 500, left: 20, width: 200, height: 40 } })

    const dice = setup({ keptValues: [6], rollCount: 1, rolled: true })
    expect(heading()).toBe('좋아요, 1개 남았어요')
    expect(blockers()).toHaveLength(4)
    expect(blockers().every((pane) => pane.dimmed)).toBe(true)
    dice.unmount()

    setup(atRecord)
    expect(heading()).toBe('6이 4개 — 이건 포커예요!')
    const panes = blockers()
    expect(panes.every((pane) => pane.dimmed)).toBe(false)
    expect(panes.every((pane) => pane.blocks)).toBe(true)
  })

  it('기록할 칸으로는 식스가 아니라 포커를 짚는다', () => {
    mountCategoryRows({
      sixes: { top: 100, left: 20, width: 200, height: 40 },
      fourOfAKind: { top: 300, left: 20, width: 200, height: 40 },
    })
    setup(atRecord)

    expect(halo().top).toBe(294)
  })

  it('족보 설명 카드는 강조한 칸 옆에 말풍선으로 붙는다', () => {
    mountCategoryRows({ ones: { top: 200, left: 700, width: 280, height: 40 } })
    const wideView = setup(atHandTour)

    const card = () => document.querySelector('[class*="rounded-card"]') as HTMLElement
    expect(card().style.right).toBe('338px')
    expect(card().style.top).toBe('220px')
    wideView.unmount()
    document.getElementById(ROWS_ID)?.remove()

    mountCategoryRows({ ones: { top: 600, left: 40, width: 88, height: 66 } })
    setup(atHandTour)
    expect(card().style.bottom).toBe('182px')
  })

  it('각 칸은 지금 주사위로 실제 몇 점인지 함께 말해 준다', async () => {
    const { user } = setup(atHandTour)

    expect(screen.getByText('지금 주사위는 이 모양이 아니라 0점이에요.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '다음' })) // 듀스
    expect(heading()).toBe('듀스')
    expect(screen.getByText('지금 주사위로 적으면 2점이에요.')).toBeVisible()
  })

  it('마지막 칸까지 보면 마무리로 간다', async () => {
    const { onClose, user } = setup(atHandTour)

    for (let page = 0; page < 11; page += 1) {
      await user.click(screen.getByRole('button', { name: '다음' }))
    }
    expect(screen.getByText('남은 족보 둘러보기 · 12 / 12')).toBeVisible()
    expect(heading()).toBe('요트')

    await user.click(screen.getByRole('button', { name: '다 봤어요' }))
    expect(heading()).toBe('한 턴을 다 하셨어요!')

    await user.click(screen.getByRole('button', { name: '연습 끝내기' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('넓은 화면에서는 기록할 곳을 점수표 행으로 안내한다', () => {
    setup({ ...atRecord, wide: true })

    expect(screen.getByRole('status')).toHaveTextContent('표시된 포커 행')
  })

  it('좁은 화면에서는 기록 패널을 짚어 준다', () => {
    setup(atRecord)

    expect(screen.getByRole('status')).toHaveTextContent('아래 기록 패널에서 표시된 포커')
  })

  it('언제든 그만둘 수 있다', async () => {
    const { onClose, user } = setup()

    await user.click(screen.getByRole('button', { name: '연습 그만두기' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
