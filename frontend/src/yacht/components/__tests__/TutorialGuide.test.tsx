import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TutorialGuide } from '@/yacht/components/TutorialGuide'

/** 첫 굴림 직후 — 대본상 [6 6 2 3 5]라 식스 후보는 12점(6이 두 개)이다. */
const AFTER_FIRST_ROLL = { ones: 1, choice: 22, sixes: 12 }
/** 마지막 굴림 뒤 — [6 6 6 6 2]라 식스 24점(6이 네 개). */
const AFTER_LAST_ROLL = { ones: 0, choice: 26, sixes: 24 }

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
const heading = () => screen.getByRole('heading').textContent

/** 족보 설명까지 와 있는 상태 — 6 두 개를 킵하고 두 번 굴린 뒤다. */
const atCategories = { keptValues: [6, 6], rollCount: 2, rolled: true }

describe('TutorialGuide', () => {
  it('플레이 신호를 따라 굴림 → 킵 → 다시 굴림 → 족보 순서로 넘어간다', async () => {
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

    rerender(
      <TutorialGuide {...baseProps} keptValues={[6, 6]} onClose={vi.fn()} rollCount={2} rolled />,
    )
    expect(heading()).toBe('족보는 점수표에서 봐요')
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

  it('족보를 다 보면 남은 마지막 굴림으로 흔들기를 체험시킨다', async () => {
    const { rerender, user } = setup(atCategories)

    await user.click(screen.getByRole('button', { name: '다 봤어요' }))
    expect(heading()).toBe('마지막 한 번은 흔들어서 굴려 볼까요?')

    // 세 번째 굴림이 끝나면 스스로 기록 단계로 넘어간다.
    rerender(
      <TutorialGuide
        {...baseProps}
        candidates={AFTER_LAST_ROLL}
        keptValues={[6, 6, 6, 6]}
        onClose={vi.fn()}
        rollCount={3}
        rolled
      />,
    )
    expect(heading()).toBe('6이 4개! 식스에 기록해요')
  })

  it('센서 안내가 없는 기기에서는 흔들기 단계를 건너뛴다', async () => {
    const { user } = setup({ ...atCategories, motionNoticeVisible: false })

    await user.click(screen.getByRole('button', { name: '다 봤어요' }))

    expect(heading()).toBe('6이 2개! 식스에 기록해요')
  })

  it('눌러야 넘어가는 단계에는 버튼 대신 어디를 누를지 알려 준다', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: '시작하기' }))

    expect(screen.getByText('표시된 곳을 눌러 보세요')).toBeVisible()
  })

  it('족보는 마스코트가 읊지 않고 점수표를 가리킨다', () => {
    // 12개를 카드로 넘기게 하면 읽기만 하다 끝난다 — 미리보기 점수가 붙은 실제 점수표를 본다.
    setup(atCategories)

    expect(heading()).toBe('족보는 점수표에서 봐요')
    // 좁은 화면의 점수표는 접혀 있다 — 퀵 칩(누르면 기록된다)이 아니라 손잡이를 올리게 한다.
    expect(screen.getByRole('status')).toHaveTextContent('손잡이를 위로 올리면')
  })

  it('넓은 화면에서는 점수표 위치를 오른쪽으로 안내한다', () => {
    setup({ ...atCategories, wide: true })

    expect(screen.getByRole('status')).toHaveTextContent('오른쪽 점수표')
  })

  it('기록이 끝나면 한 턴을 마쳤다고 알리고 연습을 끝낼 수 있다', async () => {
    const { onClose, user } = setup({
      candidates: AFTER_LAST_ROLL,
      keptValues: [6, 6, 6, 6],
      rollCount: 3,
      rolled: true,
      submitted: true,
    })

    expect(heading()).toBe('한 턴을 다 하셨어요!')

    await user.click(screen.getByRole('button', { name: '연습 끝내기' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('언제든 그만둘 수 있다', async () => {
    const { onClose, user } = setup()

    await user.click(screen.getByRole('button', { name: '연습 그만두기' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
