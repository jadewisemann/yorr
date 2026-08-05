import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { Player } from '@/realtime/wsEvents'
import { ReactionDock } from '../ReactionDock'

const players: Player[] = [
  { nickname: '정현', playerId: 'p1', status: 'online' },
  { nickname: '유진', playerId: 'p2', status: 'online' },
]

/**
 * 서버는 리액션을 <b>보낸 본인에게도</b> 되돌려준다(`GameWebSocketHandler.handleReactionSend`).
 * 내 화면에 뜨는 이모지도 전부 이 에코백을 타고 오므로, 페이크도 같이 되돌려줘야
 * "누른 것이 내 화면에 뜨는지"를 볼 수 있다 — 낙관적 렌더링은 없다.
 */
function renderDock() {
  const client = new FakeRealtimeClient({
    handlers: {
      'reaction.send': (message) => [
        {
          payload: { playerId: 'p1', reaction: message.payload.reaction },
          ts: 0,
          type: 'reaction.broadcast',
        },
      ],
    },
  })
  const view = render(
    <RealtimeClientProvider client={client}>
      <ReactionDock players={players} />
    </RealtimeClientProvider>,
  )
  return { client, user: userEvent.setup(), ...view }
}

describe('ReactionDock', () => {
  it('픽커에서 고른 이모지를 계약의 reaction 키로 보낸다', async () => {
    const { client, user } = renderDock()

    await user.click(screen.getByRole('button', { name: '리액션 보내기' }))
    await user.click(screen.getByRole('button', { name: '박수' }))

    expect(client.sentMessages).toEqual([
      expect.objectContaining({ payload: { reaction: 'clap' }, type: 'reaction.send' }),
    ])
  })

  /**
   * 리액션은 대화가 아니라 환호라서 연달아 누르는 것이 기본 사용법이다. 예전에는 하나 보내면
   * 픽커가 닫혀 세 번 보내려고 세 번 열어야 했다 — "게임 화면을 계속 덮지 않는다"는 원래
   * 의도는 바깥 누르기·Escape·트리거 다시 누르기가 대신 받는다(그 전에는 자동 닫힘이
   * 유일한 수단이었다).
   * <p>
   * 열려 있는 것만으로는 부족했다. 픽커가 트리거 <b>위</b>에 서 있던 동안에는 막 보낸
   * 이모지가 그 판 뒤에서 떠올라, 연타해도 화면이 조용했다(motion-reduce에서는 제자리에
   * 뜨므로 아예 보이지 않았다). 누른 만큼 실제로 뜨는지까지 본다.
   */
  it('연달아 보낼 수 있도록 보낸 뒤에도 픽커가 열려 있고, 누른 만큼 뜬다', async () => {
    const { client, user } = renderDock()
    const trigger = screen.getByRole('button', { name: '리액션 보내기' })

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: '박수' }))
    await user.click(screen.getByRole('button', { name: '박수' }))

    expect(client.sentMessages).toHaveLength(2)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // 에코백을 타고 내 화면에도 두 개가 떴다 — 감싸는 span 하나가 이모지 하나다.
    expect(document.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(2)
  })

  /**
   * 이모지는 트리거 <b>위</b>(`bottom-full`)로 솟는다. 픽커를 같은 자리에 두면 판이 그 통로를
   * 덮어 방금 보낸 것이 보이지 않는다 — 픽커는 옆으로 비켜서야 한다.
   * <p>
   * jsdom은 레이아웃을 계산하지 않아 겹침을 좌표로 잴 수 없다. 겹침을 정하는 것은 두 층이
   * <b>어느 변에 매달렸는지</b>이므로 그것을 본다.
   */
  it('픽커는 이모지가 솟는 통로를 비켜 선다', async () => {
    const { user } = renderDock()

    await user.click(screen.getByRole('button', { name: '리액션 보내기' }))
    await user.click(screen.getByRole('button', { name: '박수' }))

    const flying = document.querySelector('span[aria-hidden="true"]')
    expect(flying?.className).toContain('bottom-full')
    expect(screen.getByRole('toolbar').className).not.toContain('bottom-full')
  })

  it('바깥을 누르면 닫고, Escape는 트리거로 포커스를 돌린다', async () => {
    const { user } = renderDock()
    const trigger = screen.getByRole('button', { name: '리액션 보내기' })

    await user.click(trigger)
    await user.click(document.body)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // 사라진 요소에 포커스가 남으면 다음 Tab이 문서 처음으로 튄다.
    expect(trigger).toHaveFocus()
  })

  /**
   * 픽커는 닫혔을 때 트리거를 아래로 밀지 않으려고 absolute로 띄웠고, 그 결과 DOM에서
   * 트리거보다 **앞**에 있다 — 열어도 Tab을 앞으로 눌러서는 칸에 닿을 수 없었다.
   * 열면서 첫 칸에 포커스를 주고, 그 뒤는 방향키가 옮긴다(toolbar 패턴).
   */
  it('열면 첫 칸에 포커스가 가고 방향키로 옮겨 다닌다', async () => {
    const { client, user } = renderDock()

    await user.click(screen.getByRole('button', { name: '리액션 보내기' }))
    expect(screen.getByRole('button', { name: '좋아요' })).toHaveFocus()

    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('button', { name: '놀랐어요' })).toHaveFocus()

    // 양 끝에서 감싼다 — 첫 칸에서 왼쪽은 마지막 칸이다.
    await user.keyboard('{Home}{ArrowLeft}')
    expect(screen.getByRole('button', { name: 'GG' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(client.sentMessages).toEqual([
      expect.objectContaining({ payload: { reaction: 'gg' }, type: 'reaction.send' }),
    ])
  })

  /** 다섯 칸이 각각 Tab을 먹으면 헤더까지 가는 데 다섯 번을 더 눌러야 한다. */
  it('열려 있어도 Tab에 걸리는 칸은 현재 하나뿐이다', async () => {
    const { user } = renderDock()

    await user.click(screen.getByRole('button', { name: '리액션 보내기' }))

    const tabbable = ['좋아요', '웃겨요', '놀랐어요', '박수', 'GG'].filter(
      (label) => screen.getByRole('button', { name: label }).tabIndex === 0,
    )
    expect(tabbable).toEqual(['좋아요'])
  })

  /**
   * 같은 순간에 여러 개가 도착해도 서로를 가리지 않아야 한다. 좌우(--drift)만 흔들면 같은
   * 높이에 한 줄로 서고, motion-reduce에서는 제자리에 뜨는 닉네임 필이 그대로 겹친다.
   *
   * 좌표 조합의 개수를 센다 — 렌더된 위치를 재는 것은 jsdom이 레이아웃을 계산하지 않아
   * 의미가 없고, 겹치지 않음을 결정하는 것은 (drift, lift) 쌍이 서로 다른지다.
   */
  it('동시에 도착한 리액션은 서로 다른 좌표로 흩어진다', () => {
    const { client } = renderDock()

    act(() => {
      // MAX_FLYING(12)만큼 한 번에 쏟아붓는다 — 화면에 함께 떠 있을 수 있는 최대치다.
      for (let index = 0; index < 12; index += 1) {
        client.emitMessage({
          payload: { playerId: 'p1', reaction: 'like' },
          ts: 0,
          type: 'reaction.broadcast',
        })
      }
    })

    const positions = [...document.querySelectorAll<HTMLElement>('[style*="--drift"]')].map(
      (element) =>
        `${element.style.getPropertyValue('--drift')}|${element.style.getPropertyValue('--lift')}`,
    )

    expect(positions).toHaveLength(12)
    // DRIFTS(5) × LIFTS(3)가 서로소라 15가지가 돌아간다 — 12개는 전부 달라야 한다.
    expect(new Set(positions).size).toBe(12)
  })

  it('브로드캐스트된 리액션을 보낸 사람 이름과 함께 띄운다', () => {
    const { client } = renderDock()

    act(() => {
      client.emitMessage({
        payload: { playerId: 'p2', reaction: 'laugh' },
        ts: 0,
        type: 'reaction.broadcast',
      })
    })

    expect(screen.getByText('유진')).toBeInTheDocument()
    // 이모지 자체는 aria-hidden이라 낭독은 live region이 대신한다.
    expect(screen.getByRole('status')).toHaveTextContent('유진 웃겨요')
  })
})
