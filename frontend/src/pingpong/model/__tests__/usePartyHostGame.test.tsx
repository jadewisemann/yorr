import { act, render } from '@testing-library/react'
import type { ReactNode, RefObject } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { P1, P2, pingPongState } from '@/pingpong/__tests__/pingPongFixtures'
import { usePartyHostGame } from '@/pingpong/model/usePartyHostGame'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import type { PingPongState } from '@/realtime/wsEvents'
import { FRAME_MS, installFrameLoop, runFrames } from './frameHarness'
import { sceneControl } from './sceneDouble'

vi.mock('@/pingpong/rendering/scene3d', () => import('./sceneDouble'))

installFrameLoop()

const ROOM_ID = 'room-1'
/** 상태 보고 주기. `usePartyHostGame`의 값과 같다. */
const REPORT_INTERVAL_MS = 500

type Host = ReturnType<typeof usePartyHostGame>

interface RenderOptions {
  base?: PingPongState | undefined
  enabled?: boolean
}

function renderHost(options: RenderOptions = {}) {
  const client = new FakeRealtimeClient()
  const seen: { current: Host | null } = { current: null }

  function Probe({ base, enabled }: Required<Pick<RenderOptions, 'enabled'>> & RenderOptions) {
    const host = usePartyHostGame({ base, enabled, roomId: ROOM_ID })
    seen.current = host
    return <canvas data-testid="court" ref={host.canvasRef as RefObject<HTMLCanvasElement>} />
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>
  }

  const props = {
    base: 'base' in options ? options.base : pingPongState({ phase: 'PLAYING' }),
    enabled: options.enabled ?? true,
  }
  const view = render(
    <Wrapper>
      <Probe {...props} />
    </Wrapper>,
  )

  return {
    client,
    host: () => {
      if (!seen.current) throw new Error('아직 렌더되지 않았다')
      return seen.current
    },
    rerender: (next: RenderOptions) =>
      view.rerender(
        <Wrapper>
          <Probe base={next.base} enabled={next.enabled ?? true} />
        </Wrapper>,
      ),
    unmount: view.unmount,
  }
}

function reports(client: FakeRealtimeClient) {
  return client.sentMessages
    .filter((message) => message.type === 'game.ping_pong.host_state')
    .map((message) => message.payload as PingPongState)
}

function swung(playerId: string) {
  return {
    payload: { clientTs: 0, inputSeq: 1, playerId },
    ts: 0,
    type: 'game.ping_pong.swung',
  } as const
}

describe('usePartyHostGame 판정 자격', () => {
  it('대시보드가 아니면 무대도 시뮬레이션도 세우지 않는다', () => {
    const { client, host } = renderHost({ enabled: false })

    runFrames(60)
    act(() => client.emitMessage(swung(P1)))

    expect(sceneControl.scenes).toHaveLength(0)
    expect(reports(client)).toEqual([])
    expect(host().hostState).toBeUndefined()
  })

  it('서버가 준비 게이트를 끝내기 전에는 판을 잡지 않는다', () => {
    const { client, rerender } = renderHost({ base: pingPongState({ phase: 'PREPARING' }) })

    runFrames(60)
    expect(reports(client)).toEqual([])

    rerender({ base: pingPongState({ phase: 'PLAYING' }) })
    runFrames(1)

    expect(reports(client)).toHaveLength(1)
  })

  it('서버 상태가 아직 없으면 기다린다', () => {
    const { client } = renderHost({ base: undefined })

    runFrames(60)

    expect(sceneControl.scenes).toHaveLength(0)
    expect(reports(client)).toEqual([])
  })
})

describe('usePartyHostGame 상태 보고', () => {
  it('첫 프레임은 바로 올리고 그 뒤로는 주기마다 올린다', () => {
    const { client, host } = renderHost()

    runFrames(1)
    expect(reports(client)).toHaveLength(1)
    expect(host().hostState).toMatchObject({ phase: 'PLAYING', version: 5 })

    // 주기가 차기 전의 프레임은 보고하지 않는다.
    runFrames(10)
    expect(reports(client)).toHaveLength(1)

    act(() => void vi.advanceTimersByTime(REPORT_INTERVAL_MS))
    expect(reports(client).length).toBeGreaterThan(1)
  })

  it('보고 번호는 서버가 준 version에서 이어 올라간다', () => {
    const { client } = renderHost({ base: pingPongState({ phase: 'PLAYING', version: 41 }) })

    runFrames(1)
    act(() => void vi.advanceTimersByTime(REPORT_INTERVAL_MS + FRAME_MS))

    expect(reports(client).map((state) => state.version)).toEqual([42, 43])
  })

  it('국면이 바뀐 프레임은 주기를 기다리지 않고 올린다', () => {
    const { client, host } = renderHost()
    runFrames(1)
    const before = reports(client).length

    // 아무도 받지 않으면 공은 코트를 지나 득점으로 끝난다 — 그 순간이 국면 전환이다.
    runFrames(120)

    expect(host().hostState?.phase).toBe('COUNTDOWN')
    expect(reports(client).length).toBeGreaterThan(before + 1)
  })

  it('보고가 실패해도 판정은 멈추지 않는다', () => {
    const { client, host } = renderHost()
    vi.spyOn(client, 'send').mockImplementation(() => {
      throw new Error('closed')
    })

    runFrames(1)

    // 서버로 못 보냈어도 대시보드 자신의 점수판은 새 상태를 받는다.
    expect(host().hostState).toMatchObject({ phase: 'PLAYING' })
  })

  it('판정을 그만두면 무대를 정리한다', () => {
    const { unmount } = renderHost()
    runFrames(1)

    unmount()

    expect(sceneControl.last().disposed).toBe(true)
  })
})

describe('usePartyHostGame 스윙 수신', () => {
  it('playerOrder의 첫 사람이 휘두르면 1번 라켓이 나간다', () => {
    const { client, host } = renderHost()
    // 공이 1번 쪽 타격 구간에 들어설 때까지 굴린다.
    runFrames(50)

    act(() => client.emitMessage(swung(P1)))
    act(() => void vi.advanceTimersByTime(REPORT_INTERVAL_MS))

    expect(host().hostState?.rally).toBe(1)
  })

  it('방에 없는 사람의 스윙은 판에 닿지 않는다', () => {
    const { client, host } = renderHost()
    runFrames(50)

    act(() => client.emitMessage(swung('구경꾼')))
    act(() => void vi.advanceTimersByTime(REPORT_INTERVAL_MS))

    expect(host().hostState?.rally).toBe(0)
  })

  it('둘째 사람의 스윙은 공이 그쪽으로 갈 때만 라켓을 움직인다', () => {
    const { client, host } = renderHost()
    runFrames(50)

    // 공이 1번 쪽으로 가는 동안 온 2번의 스윙은 랠리로 세지 않는다. 세었다면 아래에서
    // 랠리가 3이 된다.
    act(() => client.emitMessage(swung(P2)))
    act(() => client.emitMessage(swung(P1)))
    // 되받은 공이 2번의 타격 구간에 들어설 때까지 굴린다.
    runFrames(38)
    act(() => client.emitMessage(swung(P2)))
    act(() => void vi.advanceTimersByTime(REPORT_INTERVAL_MS + FRAME_MS))

    expect(host().hostState?.rally).toBe(2)
  })

  it('판을 잡기 전에 온 스윙은 흘려보낸다', () => {
    const { client, host } = renderHost({ base: pingPongState({ phase: 'PREPARING' }) })

    // 준비 게이트가 끝나기 전이라 시뮬레이션이 아직 없다.
    act(() => client.emitMessage(swung(P1)))

    expect(host().hostState).toBeUndefined()
  })

  it('탁구가 아닌 봉투는 흘려보낸다', () => {
    const { client, host } = renderHost()
    runFrames(50)

    act(() => client.emitMessage({ payload: { serverTs: 0 }, ts: 0, type: 'sys.pong' }))
    act(() => void vi.advanceTimersByTime(REPORT_INTERVAL_MS))

    expect(host().hostState?.rally).toBe(0)
  })

  it('이미 판을 잡은 뒤에는 같은 방을 다시 세우지 않는다', () => {
    const { client, host, rerender } = renderHost()
    runFrames(30)
    const before = host().hostState?.rally

    // 같은 방의 새 프레임이 와도 시뮬레이션을 처음부터 다시 만들지 않는다.
    rerender({ base: pingPongState({ phase: 'PLAYING', version: 9 }) })
    act(() => void vi.advanceTimersByTime(REPORT_INTERVAL_MS + FRAME_MS))

    expect(host().hostState?.rally).toBe(before)
    expect(reports(client).length).toBeGreaterThan(0)
  })

  it('WebGL을 얻지 못하면 판정도 세우지 않는다', () => {
    sceneControl.failing = true
    const { client } = renderHost()

    runFrames(60)

    expect(reports(client)).toEqual([])
  })
})
