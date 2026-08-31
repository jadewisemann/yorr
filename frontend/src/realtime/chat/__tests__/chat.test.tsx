import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { creatorSession } from '@/mocks/fixtures'
import { ChatProvider, useChat } from '@/realtime/chat/ChatContext'
import { ChatDock } from '@/realtime/chat/ChatDock'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { ChatMessagePayload } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import { resetAppTestState } from '@/test/harness'

const me = creatorSession.you

function ChatHost() {
  const chat = useChat()
  const [open, setOpen] = useState(false)

  return <ChatDock chat={chat} onToggle={setOpen} open={open} you={me} />
}

function renderChat() {
  resetAppTestState()
  useAppStore.getState().setRoomSession(creatorSession)
  const client = new FakeRealtimeClient()
  const view = render(
    <RealtimeClientProvider client={client}>
      <ChatProvider>
        <ChatHost />
      </ChatProvider>
    </RealtimeClientProvider>,
  )

  const deliver = (payload: ChatMessagePayload) =>
    act(() => client.emitMessage({ payload, ts: 0, type: 'chat.message' }))

  return { client, deliver, user: userEvent.setup(), ...view }
}

const line = (overrides: Partial<ChatMessagePayload> = {}): ChatMessagePayload => ({
  messageId: 'm1',
  playerId: 'player-participant',
  nickname: '참가자',
  text: '먼저 굴려요',
  at: 1_753_000_000_000,
  ...overrides,
})

afterEach(resetAppTestState)

describe('방 채팅', () => {
  it('입력한 말을 앞뒤 공백을 다듬어 chat.send로 보낸다', async () => {
    const { client, user } = renderChat()

    await user.click(screen.getByRole('button', { name: '채팅 열기' }))
    await user.type(screen.getByLabelText('보낼 메시지'), '  좋아요  ')
    await user.click(screen.getByRole('button', { name: '보내기' }))

    expect(client.sentMessages).toEqual([
      expect.objectContaining({ payload: { text: '좋아요' }, type: 'chat.send' }),
    ])
    expect(screen.getByLabelText('보낼 메시지')).toHaveValue('')
  })

  it('공백만 입력하면 보내기를 막는다 — 서버가 거절할 요청을 만들지 않는다', async () => {
    const { client, user } = renderChat()

    await user.click(screen.getByRole('button', { name: '채팅 열기' }))
    await user.type(screen.getByLabelText('보낼 메시지'), '   ')

    expect(screen.getByRole('button', { name: '보내기' })).toBeDisabled()
    expect(client.sentMessages).toEqual([])
  })

  it('중계된 말을 보낸 사람 이름과 함께 쌓고, 같은 messageId는 한 줄로 둔다', async () => {
    const { deliver, user } = renderChat()

    deliver(line())
    deliver(line())
    deliver(line({ messageId: 'm2', playerId: me, nickname: '느긋한 주사위', text: '네' }))

    await user.click(screen.getByRole('button', { name: '채팅 열기' }))

    expect(screen.getAllByText('먼저 굴려요')).toHaveLength(1)
    expect(screen.getByText('참가자')).toBeVisible()
    // 내가 보낸 줄은 닉네임 대신 '나'로 표시한다.
    expect(screen.getByText('나')).toBeVisible()
  })

  it('접혀 있어도 최근 대화를 보여 준다 — 열어야 보이는 대화가 아니다', () => {
    const { deliver } = renderChat()

    deliver(line())

    expect(screen.getByRole('button', { name: '채팅 열기' })).toBeVisible()
    expect(screen.getByText('먼저 굴려요')).toBeVisible()
  })

  it('방을 나가면 대화 기록을 버린다 — 다음 방에 지난 말이 남지 않는다', async () => {
    const { deliver, user } = renderChat()

    deliver(line())
    act(() => useAppStore.getState().reset())

    await user.click(screen.getByRole('button', { name: '채팅 열기' }))

    expect(screen.queryByText('먼저 굴려요')).not.toBeInTheDocument()
    expect(screen.getByText('아직 대화가 없어요. 먼저 말을 걸어 보세요.')).toBeVisible()
  })
})
