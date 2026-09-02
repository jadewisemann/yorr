import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import {
  createPlayingRoomSnapshot,
  creatorSession,
  participantSession,
  serverMessage,
} from '@/mocks/fixtures'
import { createRealtimeFixture } from '@/mocks/realtimeScenarios'
import type { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import { buildClientMessage, type ClientMessageType, type RoomSnapshot } from '@/realtime/wsEvents'
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

/**
 * 활성 플레이어의 굴림 방송 하나. 관전자 화면 검사들이 "남의 주사위가 어떻게 비치는가"를
 * 보려면 먼저 이것을 흘려보내야 한다.
 */
export function broadcastRoll(client: FakeRealtimeClient, rollCount: 1 | 2 | 3 = 1) {
  act(() => {
    client.emitMessage(
      serverMessage(
        'game.yacht_dice.dice.broadcast',
        {
          dice: [6, 5, 4, 3, 2],
          held: [false, false, false, false, false],
          playerId: creatorSession.you,
          rollCount,
          roundNumber: 1,
        },
        { roomId: participantSession.roomId },
      ),
    )
  })
}

/** 굴리고 굴림을 끝낸다. 킵과 기록은 그 다음 이야기라 검사마다 다르다. */
export async function rollAndStop(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '굴리기' }))
  await user.click(screen.getByRole('button', { name: '굴림 완료' }))
}

/** 관전자 화면을 다른 스냅샷으로 다시 그린다. 턴이 넘어온 순간을 보는 검사들이 쓴다. */
export function rerenderObserver(
  rerender: (ui: ReactNode) => void,
  client: FakeRealtimeClient,
  snapshot: RoomSnapshot,
) {
  const { snapshot: _participantSnapshot, ...observerSession } = participantSession
  rerender(
    <RealtimeClientProvider client={client}>
      <GamePlay
        onLeaveRequest={() => {}}
        roomId={observerSession.roomId}
        session={observerSession}
        snapshot={snapshot}
      />
    </RealtimeClientProvider>,
  )
}

/** 굴리고, 굴림을 끝내고, 초이스 20점을 기록하는 한 턴. */
export async function rollAndRecord(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '굴리기' }))
  await user.click(screen.getByRole('button', { name: '굴림 완료' }))
  await user.click(screen.getByRole('button', { name: '초이스 20점 기록' }))
}

/** 관전자 화면에서 본 **다른 사람의 굴림 요청**. 대역이 이것을 받아 장면을 시작한다. */
export function remoteRoll(client: FakeRealtimeClient) {
  act(() => {
    client.send(
      buildClientMessage(
        'game.yacht_dice.dice.roll',
        { held: [false, false, false, false, false], rollCount: 1, roundNumber: 1 },
        { roomId: participantSession.roomId, msgId: 'remote-roll-1' },
      ),
    )
  })
}

/** 서버가 굴림 결과를 확정했다는 통지. 이것이 와야 관전자 장면이 주사위를 놓는다. */
export function remoteThrown(client: FakeRealtimeClient) {
  act(() => {
    client.emitMessage(
      serverMessage(
        'game.yacht_dice.dice.thrown',
        { playerId: creatorSession.you, rollCount: 1, roundNumber: 1 },
        { roomId: participantSession.roomId },
      ),
    )
  })
}
