import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { P1, P2, playingState } from '@/pingpong/__tests__/pingPongFixtures'
import { usePingPongGame } from '@/pingpong/model/usePingPongGame'
import { playRacketHit, playTableHit } from '@/pingpong/sounds'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { PingPongState } from '@/realtime/wsEvents'
import type { ActiveRoomSession } from '@/store'
import { pressKey } from '@/test/keys'

vi.mock('@/pingpong/sounds', () => ({
  playRacketHit: vi.fn(),
  playTableHit: vi.fn(),
}))

/** 컨트롤러 링크 대역. 파티 모드에서 스윙이 서버를 건너뛰는 갈래를 여기서 켠다. */
const { link } = vi.hoisted(() => ({
  link: { open: false, relayed: [] as unknown[] },
}))

vi.mock('@/realtime/controllerLink/ControllerLinkContext', () => ({
  useControllerLink: () => ({
    open: link.open,
    trySend: (message: unknown) => {
      if (!link.open) return false
      link.relayed.push(message)
      return true
    },
  }),
}))

const ROOM_ID = 'room-1'
const SESSION: ActiveRoomSession = {
  gameId: 'game-1',
  membershipRole: 'participant',
  nickname: '나',
  roomCode: 'ABCD',
  roomId: ROOM_ID,
  sessionToken: 'token',
  you: P1,
}

interface Options {
  dashboard?: boolean
  linkOpen?: boolean
  state?: PingPongState | undefined
}

function renderGame(options: Options = {}) {
  const client = new FakeRealtimeClient()
  link.open = options.linkOpen ?? false

  const wrapper = ({ children }: { children: ReactNode }) => (
    <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>
  )
  const view = renderHook(
    ({ state }: { state: PingPongState | undefined }) =>
      usePingPongGame({
        court: false,
        dashboard: options.dashboard ?? false,
        roomId: ROOM_ID,
        session: SESSION,
        state,
      }),
    { initialProps: { state: options.state ?? playingState() }, wrapper },
  )
  return { ...view, client, relayed: link.relayed }
}

/** 라켓이 공을 맞힌 프레임. 같은 id를 다시 보내 소리가 겹치지 않는지 본다. */
const hit = (id: number, playerId: string): PingPongState =>
  playingState({ lastEvent: { at: id, id, playerId, type: 'SMASH' } })

const sentTypes = (client: FakeRealtimeClient) => client.sentMessages.map((message) => message.type)

beforeEach(() => {
  vi.useFakeTimers()
  link.open = false
  link.relayed.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('usePingPongGame 스윙', () => {
  it('링크가 열려 있으면 서버를 거치지 않고 판정 화면으로 바로 보낸다', () => {
    const view = renderGame({ linkOpen: true })

    act(() => view.result.current.swing())

    expect(view.relayed).toHaveLength(1)
    expect(sentTypes(view.client)).toEqual([])
    expect(view.result.current.sendError).toBeNull()
  })

  it('링크가 없으면 서버로 가고, 전송이 실패하면 다시 하라고 알린다', () => {
    const view = renderGame()

    act(() => view.result.current.swing())
    expect(sentTypes(view.client)).toEqual(['game.ping_pong.swing'])

    vi.spyOn(view.client, 'send').mockImplementation(() => {
      throw new Error('closed')
    })
    act(() => view.result.current.swing())

    expect(view.result.current.sendError).toBe('연결을 확인한 뒤 다시 스윙해 주세요.')
  })

  it('판정하는 큰 화면과 칠 수 없는 국면에서는 스윙이 나가지 않는다', () => {
    const dashboard = renderGame({ dashboard: true })
    act(() => dashboard.result.current.swing())
    expect(sentTypes(dashboard.client)).toEqual([])

    const counting = renderGame({ state: playingState({ phase: 'COUNTDOWN' }) })
    act(() => counting.result.current.swing())
    expect(sentTypes(counting.client)).toEqual([])
  })

  it('스페이스바로도 휘두르되 눌린 채 반복되는 입력은 흘린다', () => {
    const view = renderGame()

    pressKey('Enter')
    pressKey('Space', { repeat: true })
    expect(sentTypes(view.client)).toEqual([])

    pressKey('Space')
    expect(sentTypes(view.client)).toEqual(['game.ping_pong.swing'])
  })
})

describe('usePingPongGame 준비', () => {
  it('준비 단계에서만 보내고, 실패하면 다시 하라고 알린다', () => {
    const playing = renderGame()
    act(() => playing.result.current.ready())
    expect(sentTypes(playing.client)).toEqual([])

    const preparing = renderGame({ state: playingState({ phase: 'PREPARING' }) })
    act(() => preparing.result.current.ready())
    expect(sentTypes(preparing.client)).toEqual(['game.ping_pong.ready'])

    vi.spyOn(preparing.client, 'send').mockImplementation(() => {
      throw new Error('closed')
    })
    act(() => preparing.result.current.ready())
    expect(preparing.result.current.sendError).toBe('연결을 확인한 뒤 다시 준비해 주세요.')
  })

  it('판정하는 큰 화면은 준비를 누르지 않는다', () => {
    const view = renderGame({ dashboard: true, state: playingState({ phase: 'PREPARING' }) })

    act(() => view.result.current.ready())

    expect(sentTypes(view.client)).toEqual([])
  })
})

describe('usePingPongGame 시계와 소리', () => {
  it('화면 시계는 스스로 흐른다 — 카운트다운이 서버 프레임을 기다리지 않는다', () => {
    const view = renderGame()
    const before = view.result.current.clock

    act(() => void vi.advanceTimersByTime(300))

    expect(view.result.current.clock).toBeGreaterThan(before)
  })

  it('새 이벤트에만 라켓 소리를 낸다', () => {
    const view = renderGame({ state: hit(1, P1) })
    expect(playRacketHit).toHaveBeenCalledOnce()

    // 같은 id의 프레임이 다시 와도 두 번 울리지 않는다.
    view.rerender({ state: hit(1, P1) })
    expect(playRacketHit).toHaveBeenCalledOnce()

    view.rerender({ state: hit(2, P2) })
    expect(playRacketHit).toHaveBeenCalledTimes(2)
  })

  it('공이 테이블에 닿는 순간에 맞춰 소리를 예약한다', () => {
    renderGame({
      state: playingState({ ball: { ...playingState().ball, launchedAt: Date.now() } }),
    })

    act(() => void vi.advanceTimersByTime(1_000))

    expect(playTableHit).toHaveBeenCalled()
  })

  it('폴트 공과 진행 중이 아닌 판에는 테이블 소리를 예약하지 않는다', () => {
    renderGame({ state: playingState({ phase: 'COUNTDOWN' }) })
    renderGame({
      state: playingState({ ball: { ...playingState().ball, fault: 'NET' } }),
    })

    act(() => void vi.advanceTimersByTime(2_000))

    expect(playTableHit).not.toHaveBeenCalled()
  })
})
