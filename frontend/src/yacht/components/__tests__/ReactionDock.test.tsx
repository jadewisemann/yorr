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

function renderDock() {
  const client = new FakeRealtimeClient()
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
    // 보내면 픽커가 닫힌다 — 게임 화면을 계속 덮고 있으면 안 된다.
    expect(screen.getByRole('button', { name: '리액션 보내기' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
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
