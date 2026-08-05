import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DuelState } from '@/realtime/wsEvents'
import { DuelController } from '../DuelController'
import { DRAW_PENALTY_MS } from '../duel'

/**
 * 파티 모드 폰 컨트롤러. (S15P11A406-207)
 *
 * 폰은 아래를 <b>잠깐</b> 본다. 그래서 검사하는 것은 "지금 뽑아야 하는지"가 한 눈에 갈리는지,
 * 그리고 뽑으면 실제로 뽑히는지다. 결투 연출은 큰 화면 몫이라 여기서 보지 않는다.
 */

const ME = 'me'
const RIVAL = 'rival'

function duelState(overrides: Partial<DuelState> = {}): DuelState {
  return {
    fouls: { [ME]: 0, [RIVAL]: 0 },
    hp: { [ME]: 3, [RIVAL]: 3 },
    lastInputSeq: {},
    nextActionAt: 0,
    phase: 'WAITING',
    playerOrder: [ME, RIVAL],
    reactions: {},
    round: 1,
    signalAt: 0,
    version: 1,
    ...overrides,
  }
}

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

describe('DuelController', () => {
  it('신호가 빨강이면 기다리라고, 초록이면 뽑으라고 말한다', () => {
    renderController(duelState({ phase: 'WAITING' }))
    expect(screen.getByText('기다려')).toBeInTheDocument()

    render(<hr />) // 앞 화면과 섞이지 않게 구분만 둔다
    renderController(duelState({ phase: 'SIGNAL', signalAt: 1 }))
    expect(screen.getByText('뽑아!')).toBeInTheDocument()
  })

  /** 한 라운드에 한 발이다 — 이미 뽑았으면 초록이라도 할 일이 없고, 내 기록이 그 자리에 뜬다. */
  it('이미 뽑았으면 초록이라도 상대를 기다린다', () => {
    renderController(duelState({ phase: 'SIGNAL', reactions: { [ME]: 231 }, signalAt: 1 }))

    expect(screen.getByText('231ms')).toBeInTheDocument()
    expect(screen.getByText('상대를 기다린다')).toBeInTheDocument()
    expect(screen.queryByText('뽑아!')).not.toBeInTheDocument()
  })

  /** 유예 중에 상대 기록이 보이면 승부가 김이 샌다 — 판정이 난 뒤에만 밝힌다. */
  it('판정 전에는 상대 기록을 숨긴다', () => {
    renderController(duelState({ phase: 'SIGNAL', reactions: { [ME]: 231, [RIVAL]: 198 } }))

    expect(screen.queryByText('198ms')).not.toBeInTheDocument()
  })

  it('화면을 누르면 뽑는다', async () => {
    const { onDraw } = renderController(duelState({ phase: 'SIGNAL', signalAt: 1 }))

    await userEvent.click(screen.getByRole('button', { name: '뽑기' }))

    expect(onDraw).toHaveBeenCalledOnce()
  })

  /**
   * 신호 전에도 눌리게 둔다 — 성급하게 당기는 것도 플레이의 일부이고 부정출발 판정은 서버
   * 몫이다. 눌러도 아무 일 없는 버튼으로 막으면 "안 눌린 것"과 구별되지 않는다.
   */
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

  /** 왜 계속 지는지 모르는 것보다, 탭이 얼마나 불리한지 알고 지는 편이 낫다. */
  it('센서를 못 쓰면 탭 페널티를 숨기지 않는다', () => {
    renderController(duelState(), { permission: 'denied' })

    expect(screen.getByText(new RegExp(`${DRAW_PENALTY_MS.tap}ms 느리게`))).toBeInTheDocument()
  })
})
