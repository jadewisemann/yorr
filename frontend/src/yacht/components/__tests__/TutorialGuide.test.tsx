import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TutorialGuide } from '@/yacht/components/TutorialGuide'

/** 첫 굴림 직후 — 대본상 [6 6 2 3 5]라 식스 후보는 12점(6이 두 개)이다. */
const AFTER_FIRST_ROLL = { ones: 1, choice: 22, sixes: 12 }
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

/** 마지막 굴림 자리 — 6 두 개를 킵하고 두 번 굴린 뒤다. 여기서 흔들기 또는 버튼 굴림으로 갈린다. */
const atLastRoll = { keptValues: [6, 6], rollCount: 2, rolled: true }

/**
 * 족보 설명까지 와 있는 상태 — 세 번을 다 굴려 주사위가 확정된 뒤다.
 * 6 네 개를 다 킵해 둬야 킵 단계를 통과한다(대본상 마지막 굴림은 6이 네 개다).
 */
const atCategories = {
  candidates: AFTER_LAST_ROLL,
  keptValues: [6, 6, 6, 6],
  rollCount: 3,
  rolled: true,
}

describe('TutorialGuide', () => {
  /*
   * 굴림 세 번이 먼저 다 끝나고, 족보 설명은 그 뒤다 — 던지다 말고 읽고 다시 던지면
   * 흐름이 끊긴다(S15P11A406-143).
   */
  it('굴림 → 킵 → 다시 굴림 → 마지막 굴림까지 끝낸 뒤에 족보로 넘어간다', async () => {
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

    // 두 번째 굴림이 끝나도 아직 족보가 아니다 — 남은 한 번을 먼저 쓴다.
    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atLastRoll} />)
    expect(heading()).toBe('마지막 한 번은 흔들어서 굴려 볼까요?')

    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atCategories} />)
    expect(heading()).toBe('이제 어디에 적을지 골라요')
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

  it('흔들기를 마다해도 마지막 굴림은 버튼으로 하게 한다', async () => {
    const { rerender, user } = setup(atLastRoll)

    expect(heading()).toBe('마지막 한 번은 흔들어서 굴려 볼까요?')
    await user.click(screen.getByRole('button', { name: '버튼으로 굴릴게요' }))

    // 흔들기를 건너뛴 사람도 족보로 바로 가지 않는다 — 세 번째 굴림이 남아 있다.
    expect(heading()).toBe('마지막 한 번 남았어요')

    rerender(<TutorialGuide {...baseProps} onClose={vi.fn()} {...atCategories} />)
    expect(heading()).toBe('이제 어디에 적을지 골라요')
  })

  it('센서가 없는 기기에서는 흔들기 대신 버튼으로 마지막 굴림을 안내한다', () => {
    setup({ ...atLastRoll, motionNoticeVisible: false })

    expect(heading()).toBe('마지막 한 번 남았어요')
  })

  it('안내보다 빨리 세 번을 다 굴려 버렸으면 흔들기를 건너뛰고 족보로 간다', () => {
    // 센서가 있어도(motionNoticeVisible 기본값 true) 이미 끝난 굴림을 한 번 더 하라고 하면
    // 따를 방법이 없다 — 위 atLastRoll(2굴림)은 흔들기로 가고, 여기는 바로 족보로 간다.
    setup(atCategories)

    expect(heading()).toBe('이제 어디에 적을지 골라요')
  })

  it('눌러야 넘어가는 단계에는 버튼 대신 어디를 누를지 알려 준다', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: '시작하기' }))

    expect(screen.getByText('표시된 곳을 눌러 보세요')).toBeVisible()
  })

  /*
   * 예전에는 "족보 설명은 ? 도움말에 있어요"로 넘겼다. 처음 온 사람에게 다른 곳을 찾아가라고
   * 하면 대개 안 찾아가므로, 규칙을 이 카드 안에서 직접 말한다.
   */
  it('족보를 다른 곳으로 넘기지 않고 카드 안에서 요약해 설명한다', () => {
    setup(atCategories)

    expect(heading()).toBe('이제 어디에 적을지 골라요')
    const summary = screen.getByRole('list')
    expect(summary).toHaveTextContent('에이스 ~ 식스')
    expect(summary).toHaveTextContent('같은 눈 3개 + 2개')
    expect(summary).toHaveTextContent('다섯 개 모두 같은 눈 · 50점')
    // 도움말·툴팁으로 미루는 문구가 남아 있으면 설명을 안 한 것이다.
    expect(screen.getByRole('status')).not.toHaveTextContent('도움말')
  })

  it('족보 요약은 지금 주사위로 실제 몇 점인지 같은 줄에 붙여 준다', () => {
    // [6 6 6 6 2] = 같은 눈 4개라 포커가 26점, 요트는 아직 0점이다.
    setup(atCategories)

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent)
    expect(rows.find((row) => row?.startsWith('포커'))).toContain('26')
    expect(rows.find((row) => row?.startsWith('요트'))).toContain('0')
    // 위 6칸은 규칙이 하나라 한 줄로 묶고, 대표할 점수 칸이 없다.
    expect(rows.find((row) => row?.startsWith('에이스 ~ 식스'))).toBe(
      '에이스 ~ 식스고른 숫자만 모아서 더해요',
    )
  })

  it('족보를 확인하면 기록 단계로 넘어간다', async () => {
    const { user } = setup(atCategories)

    await user.click(screen.getByRole('button', { name: '알겠어요' }))

    expect(heading()).toBe('6이 4개! 식스에 기록해요')
  })

  it('넓은 화면에서는 기록할 곳을 점수표 행으로 안내한다', async () => {
    const { user } = setup({ ...atCategories, wide: true })

    await user.click(screen.getByRole('button', { name: '알겠어요' }))

    expect(screen.getByRole('status')).toHaveTextContent('표시된 식스 행')
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
