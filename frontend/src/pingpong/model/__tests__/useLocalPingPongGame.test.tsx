import { act, render } from '@testing-library/react'
import type { RefObject } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { savePingPongAiResult } from '@/pingpong/api/pingPongAiResultApi'
import type { LocalPingPongDifficulty, LocalPingPongMode } from '@/pingpong/domain/localGame'
import { type TapPoint, useLocalPingPongGame } from '@/pingpong/model/useLocalPingPongGame'
import { useAppStore } from '@/store'
import { FakeResizeObserver } from '@/test/threeStubs'
import { installFrameLoop, runFrames } from './frameHarness'
import { sceneControl } from './sceneDouble'

vi.mock('@/pingpong/rendering/scene3d', () => import('./sceneDouble'))
vi.mock('@/pingpong/api/pingPongAiResultApi', () => ({
  savePingPongAiResult: vi.fn(() => Promise.resolve()),
}))

installFrameLoop()

/** 판정 안내가 화면에 머무는 시간. `useLocalPingPongGame`의 값과 같다. */
const FEEDBACK_MS = 850
const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 450

type Game = ReturnType<typeof useLocalPingPongGame>

function renderLocalGame(
  options: { difficulty?: LocalPingPongDifficulty; mode?: LocalPingPongMode } = {},
) {
  const seen: { current: Game | null } = { current: null }
  let renders = 0

  function Probe() {
    const game = useLocalPingPongGame({
      difficulty: options.difficulty ?? 'normal',
      mode: options.mode ?? 'solo',
    })
    seen.current = game
    renders += 1
    return <canvas data-testid="court" ref={game.canvasRef as RefObject<HTMLCanvasElement>} />
  }

  const view = render(<Probe />)
  const canvas = view.getByTestId('court')
  // jsdom은 캔버스 크기를 0으로 답한다. 실제 코트 크기를 심고 관찰자를 한 번 깨워
  // 무대가 그 크기를 받게 한다.
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  act(() => FakeResizeObserver.emitAll())

  return {
    canvas,
    game: () => {
      if (!seen.current) throw new Error('아직 렌더되지 않았다')
      return seen.current
    },
    renders: () => renders,
    unmount: view.unmount,
  }
}

describe('useLocalPingPongGame 무대', () => {
  it('WebGL을 얻지 못하면 무대 대신 대체 화면을 알린다', () => {
    sceneControl.failing = true

    const { game } = renderLocalGame()

    expect(game().glFailed).toBe(true)
    expect(sceneControl.scenes).toHaveLength(0)
  })

  it('캔버스 크기를 무대에 넘기고 화면을 떠날 때 무대를 정리한다', () => {
    const { unmount } = renderLocalGame()
    runFrames(1)

    expect(sceneControl.last().resizes.at(-1)).toMatchObject({
      height: CANVAS_HEIGHT,
      width: CANVAS_WIDTH,
    })
    expect(sceneControl.last().frames.length).toBeGreaterThan(0)

    unmount()
    expect(sceneControl.last().disposed).toBe(true)
  })
})

describe('useLocalPingPongGame 점수판', () => {
  it('점수와 국면이 그대로인 프레임은 화면을 다시 그리지 않는다', () => {
    const { game, renders } = renderLocalGame()
    runFrames(1)
    const before = renders()

    runFrames(3)

    expect(renders()).toBe(before)
    expect(game().hud).toMatchObject({ phase: 'playing', rally: 0, s1: 0, s2: 0 })
  })

  it('공을 놓쳐 점수가 갈리면 점수판을 새로 그린다', () => {
    const { game, renders } = renderLocalGame({ mode: 'duo' })
    const before = renders()

    // 아무도 휘두르지 않으면 공은 1번 코트를 지나 실점으로 끝난다.
    runFrames(120)

    expect(game().hud.s2).toBe(1)
    expect(game().hud.phase).toBe('point')
    expect(renders()).toBeGreaterThan(before)
  })

  it('다시 시작하면 점수판과 안내를 처음으로 돌린다', () => {
    const { game } = renderLocalGame({ mode: 'duo' })
    runFrames(120)
    expect(game().hud.s2).toBe(1)

    act(() => game().restart())

    expect(game().hud).toMatchObject({ phase: 'playing', rally: 0, s1: 0, s2: 0 })
    expect(game().feedback).toBeNull()
  })
})

describe('useLocalPingPongGame 입력', () => {
  function tapAt(canvas: HTMLElement, clientX: number): TapPoint {
    return { clientX, currentTarget: canvas }
  }

  it('둘이 하면 화면 왼쪽은 1번, 오른쪽은 2번의 라켓을 휘두른다', () => {
    const { canvas, game } = renderLocalGame({ mode: 'duo' })
    // 공이 1번 쪽 타격 구간에 들어설 때까지 굴린다.
    runFrames(50)

    // 공이 저쪽으로 가는 동안 2번은 칠 것이 없다 — 오른쪽 탭은 아무 판정도 남기지 않는다.
    act(() => game().onTap(tapAt(canvas, CANVAS_WIDTH - 10)))
    expect(game().feedback).toBeNull()

    act(() => game().onTap(tapAt(canvas, 10)))
    expect(game().feedback).toMatchObject({ kind: 'nice' })

    // 1번이 되받아 공이 방향을 바꾸면 이번에는 오른쪽 탭이 2번의 판정을 남긴다.
    act(() => game().onTap(tapAt(canvas, CANVAS_WIDTH - 10)))
    expect(game().feedback).toMatchObject({ kind: 'miss' })
  })

  it('혼자 하면 화면 어디를 눌러도 1번의 라켓만 움직인다', () => {
    const { canvas, game } = renderLocalGame({ mode: 'solo' })
    runFrames(30)

    act(() => game().onTap(tapAt(canvas, CANVAS_WIDTH - 10)))

    expect(game().feedback).not.toBeNull()
  })

  it('스페이스바는 1번, P는 둘이 할 때만 2번을 휘두른다', () => {
    const { game } = renderLocalGame({ mode: 'solo' })
    runFrames(30)

    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' })))
    act(
      () =>
        void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', repeat: true })),
    )
    expect(game().feedback).toBeNull()

    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })))
    expect(game().feedback).not.toBeNull()
  })

  it('안내는 잠시 뒤 스스로 사라진다', () => {
    const { game } = renderLocalGame({ mode: 'duo' })
    // 득점 직후를 고른다 — 다음 서브까지는 새 판정이 없어서 안내가 사라지는 것만 보인다.
    for (let frame = 0; frame < 200 && game().hud.phase !== 'point'; frame += 1) runFrames(1)
    expect(game().feedback).not.toBeNull()

    act(() => void vi.advanceTimersByTime(FEEDBACK_MS))

    expect(game().feedback).toBeNull()
    expect(game().hud.phase).toBe('point')
  })
})

/** 한 판이 끝날 때까지 굴린다. 봇 판단이 고정돼 있어 사람이 가만히 있으면 반드시 진다. */
function playUntilOver(phaseOf: () => string) {
  for (let chunk = 0; chunk < 60 && phaseOf() !== 'over'; chunk += 1) runFrames(100)
}

describe('useLocalPingPongGame 전적 보고', () => {
  it('혼자 한 판이 끝나면 사람과 AI의 최종 점수를 한 번만 올린다', () => {
    const { game } = renderLocalGame({ mode: 'solo' })

    playUntilOver(() => game().hud.phase)
    expect(game().hud.phase).toBe('over')

    expect(savePingPongAiResult).toHaveBeenCalledOnce()
    expect(savePingPongAiResult).toHaveBeenCalledWith(null, {
      aiScore: game().hud.s2,
      humanScore: game().hud.s1,
      resultId: expect.any(String),
    })

    // 끝난 뒤에도 프레임은 계속 도는데, 같은 판을 다시 올리지는 않는다.
    runFrames(100)
    expect(savePingPongAiResult).toHaveBeenCalledOnce()
  })

  it('둘이 한 판은 전적으로 남기지 않는다', () => {
    const { game } = renderLocalGame({ mode: 'duo' })

    playUntilOver(() => game().hud.phase)
    expect(game().hud.phase).toBe('over')

    expect(savePingPongAiResult).not.toHaveBeenCalled()
  })

  it('캔버스가 붙기 전에는 무대를 만들지 않는다', () => {
    function Bare() {
      useLocalPingPongGame({ difficulty: 'normal', mode: 'solo' })
      return null
    }
    render(<Bare />)

    expect(sceneControl.scenes).toHaveLength(0)
  })

  it('폰을 휘두르면 1번 라켓이 나간다', () => {
    // 권한 요청이 없는 기기로 가장한다 — `useSwing`이 곧바로 듣기 시작한다.
    vi.stubGlobal('DeviceMotionEvent', class {})
    const { game } = renderLocalGame({ mode: 'solo' })
    runFrames(30)

    act(() => {
      const motion = new Event('devicemotion') as DeviceMotionEvent & {
        acceleration: { x: number; y: number; z: number }
      }
      Object.defineProperty(motion, 'acceleration', { value: { x: 40, y: 0, z: 0 } })
      window.dispatchEvent(motion)
    })

    expect(game().feedback).not.toBeNull()
  })

  it('로그인이 바뀌어도 같은 판을 두 번 올리지 않는다', () => {
    const { game } = renderLocalGame({ mode: 'solo' })
    playUntilOver(() => game().hud.phase)
    expect(savePingPongAiResult).toHaveBeenCalledOnce()

    // 로그인 상태가 바뀌면 보고 콜백이 새로 만들어진다 — 그래도 한 번뿐이어야 한다.
    act(() =>
      useAppStore
        .getState()
        .signIn({ userId: 'member-1', nickname: '회원', sessionToken: 'token-1' }),
    )

    expect(savePingPongAiResult).toHaveBeenCalledOnce()
  })
})
