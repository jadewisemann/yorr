import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { duelState, ME, RIVAL } from '@/duel/__tests__/duelFixtures'
import { DRAW_PENALTY_MS } from '@/duel/domain/duel'
import { DuelController } from '@/duel/screens/DuelController'
import type { DuelState } from '@/realtime/wsEvents'

function renderController(state: DuelState, props: { permission?: 'denied' | 'granted' } = {}) {
  const onDraw = vi.fn()
  render(
    <DuelController
      error={null}
      nickname="나"
      onDraw={onDraw}
      onEnableMotion={vi.fn()}
      onLeave={vi.fn()}
      opponentName="상대"
      permission={props.permission ?? 'granted'}
      playerId={ME}
      state={state}
    />,
  )
  return { onDraw }
}

describe('@/duel/screens/DuelController', () => {
  it('신호가 빨강이면 기다리라고, 초록이면 뽑으라고 말한다', () => {
    renderController(duelState({ phase: 'WAITING' }))
    expect(screen.getByText('기다려')).toBeInTheDocument()

    render(<hr />)
    renderController(duelState({ phase: 'SIGNAL', signalAt: 1 }))
    expect(screen.getByText('뽑아!')).toBeInTheDocument()
  })

  it('이미 뽑았으면 초록이라도 상대를 기다린다', () => {
    renderController(duelState({ phase: 'SIGNAL', reactions: { [ME]: 231 }, signalAt: 1 }))

    expect(screen.getByText('231ms')).toBeInTheDocument()
    expect(screen.getByText('상대를 기다린다')).toBeInTheDocument()
    expect(screen.queryByText('뽑아!')).not.toBeInTheDocument()
  })

  it('판정 전에는 상대 기록을 숨긴다', () => {
    renderController(duelState({ phase: 'SIGNAL', reactions: { [ME]: 231, [RIVAL]: 198 } }))

    expect(screen.queryByText('198ms')).not.toBeInTheDocument()
  })

  it('화면을 누르면 뽑는다', async () => {
    const { onDraw } = renderController(duelState({ phase: 'SIGNAL', signalAt: 1 }))

    await userEvent.click(screen.getByRole('button', { name: '뽑기' }))

    expect(onDraw).toHaveBeenCalledOnce()
  })

  it('신호 전에도 뽑기를 받는다', async () => {
    const { onDraw } = renderController(duelState({ phase: 'WAITING' }))

    await userEvent.click(screen.getByRole('button', { name: '뽑기' }))

    expect(onDraw).toHaveBeenCalledOnce()
  })

  it('쌓인 부정출발 경고와 그 결과를 알려준다', () => {
    renderController(duelState({ fouls: { [ME]: 1, [RIVAL]: 0 } }))

    const warning = screen.getByText(/부정출발 경고/)
    expect(warning).toHaveTextContent('부정출발 경고 1/2')
    expect(warning).toHaveTextContent('한 번 더면 자기 발을 쏜다')
  })

  it('센서를 못 쓰면 탭 페널티를 숨기지 않는다', () => {
    renderController(duelState(), { permission: 'denied' })

    expect(screen.getByText(new RegExp(`${DRAW_PENALTY_MS.tap}ms 느리게`))).toBeInTheDocument()
  })
})
