import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TutorialGuide } from '@/yacht/components/TutorialGuide'

const ROWS_ID = 'fake-score-rows'

/**
 * 점수표 행을 흉내 낸다 — 가이드는 data-tutorial-category 표지로 강조할 칸을 찾으므로,
 * 이 표지가 없으면 강조할 것을 못 찾아 구멍 없이 화면만 덮는다.
 * jsdom의 getBoundingClientRect는 전부 0을 주니 칸마다 좌표를 따로 물려 준다.
 */
function mountCategoryRows(rects: Record<string, FakeRect>) {
  for (const [category, rect] of Object.entries(rects)) {
    const row = targetHolder().appendChild(document.createElement('div'))
    row.dataset.tutorialCategory = category
    row.getBoundingClientRect = () => domRect(rect)
  }
}

/** 트레이·굴리기 버튼처럼 data-tutorial 표지로 찾는 자리를 흉내 낸다. */
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

/** 가이드는 top·left·width·height만 읽지만, 반환형은 DOMRect를 지켜야 한다. */
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

/**
 * 구멍을 둘러싼 차단막 네 장. 덮는지(dimmed)와 클릭을 막는지(blocks)를 따로 본다 —
 * 색을 빼도 막기는 남아야 한다.
 */
function blockers() {
  const host = document.querySelector('[role="presentation"]')
  if (!host) throw new Error('안내 오버레이를 찾을 수 없습니다')
  return [...host.children]
    .filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.className.includes('pointer-events-auto') &&
        // 설명 카드도 클릭을 받아야 하므로 pointer-events-auto다 — 차단막과 구분한다.
        !child.className.includes('rounded-card'),
    )
    .map((pane) => ({
      dimmed: pane.className.includes('bg-black/72'),
      blocks: pane.className.includes('pointer-events-auto'),
    }))
}

/** 강조 링의 위치·크기. Backdrop이 구멍 좌표(타깃에서 6px 바깥)로 그린 값이다. */
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

/** 첫 굴림 직후 — 대본상 [6 6 2 3 5]라 식스 후보는 12점(6이 두 개)이다. */
const AFTER_FIRST_ROLL = { ones: 1, choice: 22, sixes: 12 }
/** 두 번째 굴림 뒤 — 대본상 [6 6 6 4 1]이라 식스 18점(6이 세 개). */
const AFTER_SECOND_ROLL = { ones: 1, choice: 23, sixes: 18 }
/**
 * 마지막 굴림 뒤 — 대본상 [6 6 6 6 2]다. 식스 24점(6이 네 개), 같은 눈 4개라 포커도 26점.
 * 스트레이트·풀하우스·요트는 모양이 아니라 0점이다.
 */
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
  submitted: false,
  wide: false,
}

const setup = (props: Partial<Parameters<typeof TutorialGuide>[0]> = {}) => {
  const onClose = vi.fn()
  const view = render(<TutorialGuide {...baseProps} onClose={onClose} {...props} />)
  return { ...view, onClose, user: userEvent.setup() }
}

/** 안내 카드의 제목. 단계가 바뀌었는지는 이걸로 본다. */
const heading = () => screen.getByRole('heading', { level: 2 }).textContent

/** 두 번째 굴림 뒤 선택 자리 — 6이 3개로 늘었는데 아직 두 개만 킵했다. */
const atKeepAgain = {
  candidates: AFTER_SECOND_ROLL,
  keptValues: [6, 6],
  rollCount: 2,
  rolled: true,
}

/** 마지막 굴림 자리 — 두 번째 선택까지 끝났고 굴림 한 번이 남았다. */
const atLastRoll = {
  candidates: AFTER_SECOND_ROLL,
  keptValues: [6, 6, 6],
  rollCount: 2,
  rolled: true,
}

/**
 * 기록 자리 — 세 번을 다 굴려 주사위가 확정된 뒤다.
 * 6 네 개를 다 킵해 둬야 선택 단계를 통과한다(대본상 마지막 굴림은 6이 네 개다).
 */
const atRecord = {
  candidates: AFTER_LAST_ROLL,
  keptValues: [6, 6, 6, 6],
  rollCount: 3,
  rolled: true,
}

/**
 * 포커를 기록한 뒤 — 그 칸은 candidates에서 빠지고 남은 11칸의 점수만 남는다.
 * 주사위는 [6 6 6 6 2] 그대로라(기록해도 다음 라운드가 시작되기 전까지 유지된다)
 * 듀스 2점 · 식스 24점 · 초이스 26점이고 나머지는 모양이 아니라 0점이다.
 */
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

/** 족보 둘러보기 자리 — 기록까지 끝났다. */
const atHandTour = {
  candidates: AFTER_RECORD,
  keptValues: [6, 6, 6, 6],
  rollCount: 3,
  rolled: true,
  submitted: true,
}

describe('TutorialGuide', () => {
  /*
   * 순서는 굴림·선택을 두 번 되풀이 → 흔들기로 마지막 굴림 → 한 칸 직접 기록 →
   * 남은 족보 둘러보기다. 규칙 열두 개를 먼저 읽히면 무엇을 위한 규칙인지 모르는 채로
   * 읽게 되므로, 한 칸을 적어 본 뒤로 미룬다(S15P11A406-143).
   */
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

    // 두 번째 굴림 뒤에도 고르는 단계가 온다 — 이 반복이 요트의 한 턴이다.
    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atKeepAgain} />)
    expect(heading()).toBe('6이 3개로 늘었어요')

    // 다 고르면 바로 지시하지 않고 어떻게 던질지 먼저 묻는다.
    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atLastRoll} />)
    expect(heading()).toBe('이제 마지막 한 번이 남았어요')
    await user.click(screen.getByRole('button', { name: '흔들어서 던지기' }))
    expect(heading()).toBe('폰을 흔들어서 던져요')

    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atRecord} />)
    expect(heading()).toBe('6이 4개 — 이건 포커예요!')

    // 기록을 마치면 그때 족보 둘러보기가 시작된다.
    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atHandTour} />)
    expect(heading()).toBe('에이스')
  })

  /*
   * keepAgain은 keep과 같은 조건("6을 다 킵했나")으로 기다린다. 그래서 냉시작으로는 도달할 수
   * 없고, 두 번째 굴림이 6을 늘려 조건이 다시 깨지는 전이를 거쳐야 한다 — 실제 플레이 그대로다.
   */
  it('두 번째 선택을 마치지 않으면 마지막 굴림으로 넘어가지 않는다', () => {
    const { rerender } = setup({ keptValues: [6, 6], rollCount: 1, rolled: true })
    expect(heading()).toBe('나머지만 다시 굴려요')

    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atKeepAgain} />)

    expect(heading()).toBe('6이 3개로 늘었어요')
    expect(screen.getByRole('status')).toHaveTextContent('새로 나온 6 1개도 탭해서 킵해 보세요')
  })

  /*
   * 6이 두 개인데 하나만 킵하고 넘어가면 "같은 눈을 모은다"를 절반만 해본 셈이다.
   * 초심자용이므로 다 할 때까지 기다린다.
   */
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

  /*
   * 고르기를 끝낸 직후에 곧바로 "센서를 켜라"로 넘어가면 방금 고른 결과를 볼 틈도 없이 다음
   * 지시가 떨어진다. 한 번 묻고, 사용자가 고른 쪽으로만 움직인다.
   */
  it('선택이 끝나면 지시하지 않고 어떻게 던질지 먼저 묻는다', async () => {
    const { user } = setup(atLastRoll)

    expect(heading()).toBe('이제 마지막 한 번이 남았어요')
    expect(screen.getByRole('button', { name: '흔들어서 던지기' })).toBeVisible()
    expect(screen.getByRole('button', { name: '버튼으로 던지기' })).toBeVisible()
    // 아직 센서 이야기는 꺼내지 않는다.
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
    // 센서가 있어도(motionNoticeVisible 기본값 true) 이미 끝난 굴림을 한 번 더 하라고 하면
    // 따를 방법이 없다 — 위 atLastRoll(2굴림)은 흔들기로 가고, 여기는 바로 기록으로 간다.
    setup(atRecord)

    expect(heading()).toBe('6이 4개 — 이건 포커예요!')
  })

  /*
   * 대본 마지막 굴림은 6이 네 개다 — 식스(24점)이면서 동시에 포커(26점)다. 더 높고 이름이
   * 있는 쪽을 짚어야 "같은 눈 네 개는 이름이 붙는다"가 남는다.
   */
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

  /*
   * 예전에는 "족보 설명은 ? 도움말에 있어요"로 넘겼다. 처음 온 사람에게 다른 곳을 찾아가라고
   * 하면 대개 안 찾아가므로, 마스코트가 한 장씩 직접 말한다.
   */
  it('족보를 다른 곳으로 넘기지 않고 한 칸씩 말풍선으로 설명한다', async () => {
    const { user } = setup(atHandTour)

    // 기록한 포커는 빠지고 남은 11칸을 돈다.
    expect(screen.getByText('남은 족보 둘러보기 · 1 / 11')).toBeVisible()
    expect(heading()).toBe('에이스')
    // 도움말·툴팁으로 미루는 문구가 남아 있으면 설명을 안 한 것이다.
    expect(screen.getByRole('status')).not.toHaveTextContent('도움말')

    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('남은 족보 둘러보기 · 2 / 11')).toBeVisible()
    expect(heading()).toBe('듀스')
  })

  /*
   * 위 여섯 칸도 "고른 숫자만 더해요" 한 줄로 묶지 않는다. 규칙은 맞지만 점수표에서 어느 칸이
   * 무엇인지는 여전히 모르고, 설명하는 칸을 화면에서 같이 짚으므로 하나씩이어야 뜻이 있다.
   */
  it('에이스·듀스 같은 위 칸도 묶지 않고 하나씩 설명한다', async () => {
    const { user } = setup(atHandTour)

    const upper = ['에이스', '듀스', '트레이', '포', '파이브', '식스']
    for (const [index, label] of upper.entries()) {
      expect(heading()).toBe(label)
      if (index < upper.length - 1) await user.click(screen.getByRole('button', { name: '다음' }))
    }
  })

  /*
   * 규칙만 읽어 주면 점수표에서 어느 칸인지는 여전히 모른다. 설명하는 칸을 화면에서 같이
   * 짚어야 이름과 자리가 붙는다 — 링은 타깃 사방 6px 바깥에 그려진다.
   */
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

  /*
   * 점수표를 다루는 동안에는 덮지 않는다 — 어둠이 표를 통째로 지우면 어느 칸에 적는 중인지,
   * 적고 나서 무엇이 바뀌었는지를 볼 수 없다. 차단막은 색만 빠지고 그대로 남는다.
   */
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
    // 덮지 않아도 엉뚱한 곳은 눌리지 않아야 한다.
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

  it('각 칸은 지금 주사위로 실제 몇 점인지 함께 말해 준다', async () => {
    // [6 6 6 6 2] — 듀스는 2점, 에이스는 모양이 없어 0점이다.
    const { user } = setup(atHandTour)

    expect(screen.getByText('지금 주사위는 이 모양이 아니라 0점이에요.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '다음' })) // 듀스
    expect(heading()).toBe('듀스')
    expect(screen.getByText('지금 주사위로 적으면 2점이에요.')).toBeVisible()
  })

  it('마지막 칸까지 보면 마무리로 간다', async () => {
    const { onClose, user } = setup(atHandTour)

    // 11칸 중 열 번은 '다음', 마지막 한 번만 '다 봤어요'다.
    for (let page = 0; page < 10; page += 1) {
      await user.click(screen.getByRole('button', { name: '다음' }))
    }
    expect(screen.getByText('남은 족보 둘러보기 · 11 / 11')).toBeVisible()
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
