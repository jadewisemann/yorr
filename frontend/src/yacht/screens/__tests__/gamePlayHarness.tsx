import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { createPlayingRoomSnapshot, creatorSession, participantSession } from '@/mocks/fixtures'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import type { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { ClientMessageType, RoomSnapshot } from '@/realtime/wsEvents'
import { useAppStore } from '@/store'
import { GamePlay } from '@/yacht/screens/GamePlay'

/**
 * 야추 게임 화면을 실제 스토어·실시간 클라이언트와 함께 세우는 하네스. 물리 주사위
 * 장면만 대역으로 바꾼다 — jsdom에는 WebGL이 없고, 이 스위트가 보는 것은 주사위가
 * 어떻게 굴러가는지가 아니라 화면이 서버 메시지에 어떻게 반응하는지다.
 */

const { snapshot: _snapshot, ...session } = creatorSession

export function renderGame(options: { client?: FakeRealtimeClient; snapshot?: RoomSnapshot } = {}) {
  const snapshot = options.snapshot ?? createPlayingRoomSnapshot(Date.now() + 30_000)
  const client = options.client ?? createRealtimeFixture()
  useAppStore.setState({ connectionStatus: 'connected', roomSnapshot: snapshot })
  const tree = (current: RoomSnapshot) => (
    <RealtimeClientProvider client={client}>
      <GamePlay
        onLeaveRequest={() => {}}
        roomId={session.roomId}
        session={session}
        snapshot={current}
      />
    </RealtimeClientProvider>
  )
  const view = render(tree(snapshot))
  return {
    ...view,
    client,
    rerenderWith: (next: RoomSnapshot) => view.rerender(tree(next)),
    user: userEvent.setup(),
  }
}

export function withheldResponse(client: FakeRealtimeClient, type: ClientMessageType) {
  const send = client.send.bind(client)
  vi.spyOn(client, 'send').mockImplementation((message) => {
    if (message.type === type) {
      client.sentMessages.push(message)
      return
    }
    send(message)
  })
  return client
}

export function brokenSend(client: FakeRealtimeClient, type: ClientMessageType) {
  const send = client.send.bind(client)
  vi.spyOn(client, 'send').mockImplementation((message) => {
    if (message.type === type) throw new Error('socket is closed')
    send(message)
  })
  return client
}

export function lastMsgId(client: FakeRealtimeClient, type: ClientMessageType) {
  const msgId = [...client.sentMessages].reverse().find((message) => message.type === type)?.msgId
  if (!msgId) throw new Error(`no sent message of type ${type}`)
  return msgId
}

export function renderObserver(snapshot = createPlayingRoomSnapshot(Date.now() + 30_000)) {
  const client = createRealtimeFixture({ role: 'creator' })
  const { snapshot: _participantSnapshot, ...observerSession } = participantSession
  useAppStore.setState({ connectionStatus: 'connected', roomSnapshot: snapshot })
  return {
    ...render(
      <RealtimeClientProvider client={client}>
        <GamePlay
          onLeaveRequest={() => {}}
          roomId={observerSession.roomId}
          session={observerSession}
          snapshot={snapshot}
        />
      </RealtimeClientProvider>,
    ),
    client,
    user: userEvent.setup(),
  }
}

export function SyncedGamePlay() {
  const roomSession = useAppStore((state) => state.roomSession)
  const roomSnapshot = useAppStore((state) => state.roomSnapshot)
  if (!roomSession || !roomSnapshot) return null
  return (
    <GamePlay
      onLeaveRequest={() => {}}
      roomId={roomSession.roomId}
      session={roomSession}
      snapshot={roomSnapshot}
    />
  )
}
