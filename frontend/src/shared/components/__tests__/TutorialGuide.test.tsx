import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TutorialGuide } from '@/shared/components/TutorialGuide'

const baseProps = {
  isMyTurn: true,
  kept: false,
  rolled: false,
  submitted: false,
}

const setup = (props: Partial<Parameters<typeof TutorialGuide>[0]> = {}) => {
  const handlers = {
    onFinish: vi.fn(),
    onNeverShowAgain: vi.fn(),
    onSkip: vi.fn(),
  }
  const view = render(<TutorialGuide {...baseProps} {...handlers} {...props} />)
  return { ...view, handlers, user: userEvent.setup() }
}

describe('TutorialGuide', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('플레이 신호(굴림→킵→기록)에 반응해 안내가 넘어가고, 끝나면 스스로 퇴장한다', async () => {
    const { handlers, rerender, user } = setup()

    expect(screen.getByRole('status')).toHaveTextContent('안녕, 난 요르!')
    await user.click(screen.getByRole('button', { name: '좋아, 알려줘!' }))
    expect(screen.getByRole('status')).toHaveTextContent('굴리기 버튼을 누르거나')

    rerender(<TutorialGuide {...baseProps} {...handlers} rolled />)
    expect(screen.getByRole('status')).toHaveTextContent('탭하면 킵 돼')

    rerender(<TutorialGuide {...baseProps} {...handlers} rolled kept />)
    expect(screen.getByRole('status')).toHaveTextContent('족보를 탭해서 기록해')

    // 자동 퇴장 타이머만 가짜 시계로 감는다 — userEvent와 fake timer를 섞으면 대기가 꼬인다.
    vi.useFakeTimers()
    rerender(<TutorialGuide {...baseProps} {...handlers} rolled kept submitted />)
    expect(screen.getByRole('status')).toHaveTextContent('완벽해')

    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(handlers.onFinish).toHaveBeenCalledTimes(1)
  })

  it('내 차례가 아니면 기다렸다가 차례가 오면 굴리기 안내로 넘어간다', async () => {
    const { handlers, rerender, user } = setup({ isMyTurn: false })

    await user.click(screen.getByRole('button', { name: '좋아, 알려줘!' }))
    expect(screen.getByRole('status')).toHaveTextContent('다른 사람 차례야')

    rerender(<TutorialGuide {...baseProps} {...handlers} isMyTurn />)
    expect(screen.getByRole('status')).toHaveTextContent('네 차례야!')
  })

  it('건너뛰기·다시 보지 않기는 각자의 콜백을 부른다', async () => {
    const { handlers, user } = setup()

    await user.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(handlers.onSkip).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '다시 보지 않기' }))
    expect(handlers.onNeverShowAgain).toHaveBeenCalledTimes(1)
  })
})
