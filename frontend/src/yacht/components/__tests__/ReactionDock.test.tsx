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

  it('연달아 보낼 수 있도록 보낸 뒤에도 픽커가 열려 있고, 누른 만큼 뜬다', async () => {
    const { client, user } = renderDock()
    const trigger = screen.getByRole('button', { name: '리액션 보내기' })

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: '박수' }))
    await user.click(screen.getByRole('button', { name: '박수' }))

    expect(client.sentMessages).toHaveLength(2)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(2)
  })

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
    expect(trigger).toHaveFocus()
  })

  it('열면 첫 칸에 포커스가 가고 방향키로 옮겨 다닌다', async () => {
    const { client, user } = renderDock()

    await user.click(screen.getByRole('button', { name: '리액션 보내기' }))
    expect(screen.getByRole('button', { name: '좋아요' })).toHaveFocus()

    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('button', { name: '놀랐어요' })).toHaveFocus()

    await user.keyboard('{Home}{ArrowLeft}')
    expect(screen.getByRole('button', { name: 'GG' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(client.sentMessages).toEqual([
      expect.objectContaining({ payload: { reaction: 'gg' }, type: 'reaction.send' }),
    ])
  })

  it('열려 있어도 Tab에 걸리는 칸은 현재 하나뿐이다', async () => {
    const { user } = renderDock()

    await user.click(screen.getByRole('button', { name: '리액션 보내기' }))

    const tabbable = ['좋아요', '웃겨요', '놀랐어요', '박수', 'GG'].filter(
      (label) => screen.getByRole('button', { name: label }).tabIndex === 0,
    )
    expect(tabbable).toEqual(['좋아요'])
  })

  it('동시에 도착한 리액션은 서로 다른 좌표로 흩어진다', () => {
    const { client } = renderDock()

    act(() => {
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
    expect(screen.getByRole('status')).toHaveTextContent('유진 웃겨요')
  })
})
