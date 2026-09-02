import { act, render } from '@testing-library/react'
import type { ReactNode, RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { duelRound, duelState, ME, RIVAL } from '@/duel/__tests__/duelFixtures'
import { DRAW_PENALTY_MS, flightMs } from '@/duel/domain/duel'
import { useDuelGame } from '@/duel/model/useDuelGame'
import { playGunHit, playGunShot } from '@/duel/sounds'
import { FakeRealtimeClient } from '@/realtime/fakeRealtimeClient'
import { RealtimeClientProvider } from '@/realtime/RealtimeClientContext'
import { DUEL_FOUL, type DuelState } from '@/realtime/wsEvents'
import type { ActiveRoomSession } from '@/store'
import { pressKey } from '@/test/keys'
import { FakeResizeObserver } from '@/test/threeStubs'

vi.mock('@/duel/sounds', () => ({
  playGunHit: vi.fn(),
  playGunShot: vi.fn(),
}))

const ROOM_ID = 'room-1'
const STAGE_WIDTH = 1000
/** 총알이 무대를 가로지르는 시간. 아래 검사들이 이 값에서 지연을 빼며 센다. */
const FLIGHT = flightMs(STAGE_WIDTH)

const SESSION: ActiveRoomSession = {
  gameId: 'game-1',
  membershipRole: 'participant',
  nickname: '나',
  roomCode: 'ABCD',
  roomId: ROOM_ID,
  sessionToken: 'token',
  you: ME,
}

type Game = ReturnType<typeof useDuelGame>

function renderDuelGame(initialState: DuelState | undefined, client = new FakeRealtimeClient()) {
  const seen: { current: Game | null } = { current: null }

  function Probe({ state }: { state: DuelState | undefined }) {
    const game = useDuelGame({ roomId: ROOM_ID, session: SESSION, state })
    seen.current = game
    return <div data-testid="stage" ref={game.stageRef as RefObject<HTMLDivElement>} />
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>
  }

  const view = render(
    <Wrapper>
      <Probe state={initialState} />
    </Wrapper>,
  )

  // 무대 폭은 `getBoundingClientRect`로 재는데 jsdom은 0을 준다 — 실제 폰 폭을 흉내 내
  // 총알 비행 시간이 하한(260ms)에 눌리지 않게 한다.
  const stage = view.getByTestId('stage')
  stage.getBoundingClientRect = () => new DOMRect(0, 0, STAGE_WIDTH, 0)
  act(() => FakeResizeObserver.emitAll())

  return {
    client,
    game: () => {
      if (!seen.current) throw new Error('아직 렌더되지 않았다')
      return seen.current
    },
    rerender: (state: DuelState | undefined) =>
      view.rerender(
        <Wrapper>
          <Probe state={state} />
        </Wrapper>,
      ),
    unmount: view.unmount,
  }
}

function drawPayloads(client: FakeRealtimeClient) {
  return client.sentMessages
    .filter((message) => message.type === 'game.duel.draw')
    .map((message) => message.payload)
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeResizeObserver.reset()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('useDuelGame 뽑기', () => {
  it('신호 전에 뽑으면 반칙 값을 보내고 총구를 땅으로 돌린다', () => {
    const { client, game } = renderDuelGame(duelState({ phase: 'WAITING' }))

    act(() => game().draw('tap'))

    expect(drawPayloads(client)).toEqual([{ inputSeq: 1, reactionMs: DUEL_FOUL }])
    expect(game().myShot).toMatchObject({ round: 1, target: 'ground' })
    expect(playGunShot).toHaveBeenCalledOnce()
  })

  it('신호를 본 뒤 뽑으면 잰 시간에 입력 수단의 벌점을 더해 보낸다', () => {
    const { client, game, rerender } = renderDuelGame(duelState({ phase: 'WAITING' }))

    rerender(duelState({ phase: 'SIGNAL', signalAt: 1 }))
    act(() => void vi.advanceTimersByTime(200))
    act(() => game().draw('tap'))

    // 탭 벌점(100ms)만큼 전송을 미룬다 — 그 사이에는 아무것도 나가지 않는다.
    expect(drawPayloads(client)).toEqual([])
    act(() => void vi.advanceTimersByTime(DRAW_PENALTY_MS.tap))
    expect(drawPayloads(client)).toEqual([{ inputSeq: 1, reactionMs: 200 + DRAW_PENALTY_MS.tap }])
    expect(game().myShot).toMatchObject({ target: 'opponent' })
  })

  it('벌점 없는 휘두르기는 미루지 않고 바로 보낸다', () => {
    const { client, game, rerender } = renderDuelGame(duelState({ phase: 'WAITING' }))

    rerender(duelState({ phase: 'SIGNAL', signalAt: 1 }))
    act(() => void vi.advanceTimersByTime(150))
    act(() => game().draw('swing'))

    expect(drawPayloads(client)).toEqual([{ inputSeq: 1, reactionMs: 150 }])
  })

  it('상태가 없거나 판정 중이거나 이미 반응했으면 뽑기를 무시한다', () => {
    const { client, game, rerender } = renderDuelGame(undefined)

    act(() => game().draw('tap'))
    rerender(duelState({ lastRound: duelRound(), phase: 'RESULT' }))
    act(() => game().draw('tap'))
    rerender(duelState({ phase: 'SIGNAL', reactions: { [ME]: 210 }, signalAt: 1 }))
    act(() => game().draw('tap'))

    expect(drawPayloads(client)).toEqual([])
    expect(game().myShot).toBeNull()
  })

  it('전송이 실패하면 쏜 기록을 되돌리고 다시 뽑으라고 알린다', () => {
    const client = new FakeRealtimeClient()
    vi.spyOn(client, 'send').mockImplementation(() => {
      throw new Error('closed')
    })
    const { game } = renderDuelGame(duelState({ phase: 'WAITING' }), client)

    act(() => game().draw('tap'))

    expect(game().myShot).toBeNull()
    expect(game().sendError).toBe('연결을 확인한 뒤 다시 뽑아 주세요.')
  })

  it('스페이스바로도 뽑되 눌린 채 반복되는 입력은 흘린다', () => {
    const { client, game } = renderDuelGame(duelState({ phase: 'WAITING' }))

    pressKey('Enter')
    pressKey('Space', { repeat: true })
    expect(drawPayloads(client)).toEqual([])

    pressKey('Space')
    expect(drawPayloads(client)).toEqual([{ inputSeq: 1, reactionMs: DUEL_FOUL }])
    expect(game().myShot).toMatchObject({ target: 'ground' })
  })

  it('화면을 떠나면 대기 중이던 벌점 전송을 취소한다', () => {
    const { client, game, rerender, unmount } = renderDuelGame(duelState({ phase: 'WAITING' }))

    rerender(duelState({ phase: 'SIGNAL', signalAt: 1 }))
    act(() => game().draw('key'))
    unmount()
    act(() => void vi.advanceTimersByTime(DRAW_PENALTY_MS.key))

    expect(drawPayloads(client)).toEqual([])
  })
})

describe('useDuelGame 피격 시점', () => {
  /** 대기 상태로 시작해 한 라운드의 결과를 받는 흐름. 피격 검사가 모두 여기서 출발한다. */
  function renderResult(round: Parameters<typeof duelRound>[0]) {
    const view = renderDuelGame(duelState({ phase: 'WAITING' }))
    view.rerender(duelState({ lastRound: duelRound(round), phase: 'RESULT' }))
    return view
  }

  it('내 총알이면 이미 날아간 만큼을 빼고 남은 비행 시간만 기다린다', () => {
    const { game, rerender } = renderDuelGame(duelState({ phase: 'WAITING' }))

    rerender(duelState({ phase: 'SIGNAL', signalAt: 1 }))
    act(() => game().draw('swing'))
    act(() => void vi.advanceTimersByTime(100))
    rerender(
      duelState({
        lastRound: duelRound({ hitId: RIVAL, shooterId: ME }),
        phase: 'RESULT',
      }),
    )

    expect(game().impactDelay).toBe(FLIGHT - 100)
  })

  it('상대 총알이면 도착 시각을 알 수 없으므로 비행 시간을 그대로 쓴다', () => {
    const { game } = renderResult({ hitId: ME, shooterId: RIVAL })

    expect(game().impactDelay).toBe(FLIGHT)
  })

  it('총알이 닿는 프레임에 피격 자세를 켜고 명중음을 낸다', () => {
    const { game } = renderResult({ hitId: ME, shooterId: RIVAL })
    expect(game().impact).toBe(false)

    // 타이머가 깨어난 뒤 화면에 칠해지기까지의 지연(45ms)만큼 앞당겨 깨운다.
    act(() => void vi.advanceTimersByTime(FLIGHT - 45))

    expect(game().impact).toBe(true)
    expect(playGunHit).toHaveBeenCalledOnce()
  })

  it('아무도 맞지 않은 라운드에는 명중음을 내지 않는다', () => {
    const { game } = renderResult({ kind: 'TIE' })

    act(() => void vi.advanceTimersByTime(FLIGHT))

    expect(game().impact).toBe(true)
    expect(playGunHit).not.toHaveBeenCalled()
  })
})

describe('useDuelGame 발사음', () => {
  it('새 라운드 결과가 오면 그 라운드의 총성을 한 번만 낸다', () => {
    const { rerender } = renderDuelGame(duelState({ phase: 'WAITING' }))
    const round = duelRound({ hitId: RIVAL, shooterId: ME })

    rerender(duelState({ lastRound: round, phase: 'RESULT' }))
    rerender(duelState({ lastRound: { ...round }, phase: 'RESULT' }))

    expect(playGunShot).toHaveBeenCalledOnce()
  })

  it('내가 뽑으며 이미 낸 총성을 결과가 다시 내지 않는다', () => {
    const { game, rerender } = renderDuelGame(duelState({ phase: 'WAITING' }))

    act(() => game().draw('swing'))
    rerender(
      duelState({
        lastRound: duelRound({ foulId: ME, kind: 'WARNING' }),
        phase: 'RESULT',
      }),
    )

    expect(playGunShot).toHaveBeenCalledOnce()
  })

  it('상대가 나가서 끝난 라운드에는 총성이 없다', () => {
    const { rerender } = renderDuelGame(duelState({ phase: 'WAITING' }))

    rerender(
      duelState({
        lastRound: duelRound({ kind: 'FORFEIT', number: 2 }),
        phase: 'RESULT',
      }),
    )

    expect(playGunShot).not.toHaveBeenCalled()
  })
})
