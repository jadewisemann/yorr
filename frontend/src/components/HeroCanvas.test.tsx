import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HeroGameKey } from '@/landingGames'
import type { HeroSceneOptions } from '@/rendering/hero/heroScene'
import { HeroCanvas } from './HeroCanvas'

interface FakeScene {
  destroy: ReturnType<typeof vi.fn>
  options: HeroSceneOptions
  setGame: ReturnType<typeof vi.fn>
}

const { scenes } = vi.hoisted(() => ({ scenes: [] as FakeScene[] }))

vi.mock('@/rendering/hero/heroScene', () => ({
  HeroScene: class {
    destroy = vi.fn()
    options: HeroSceneOptions
    setGame = vi.fn()

    constructor(options: HeroSceneOptions) {
      this.options = options
      scenes.push(this as unknown as FakeScene)
    }
  },
}))

/** WebGL을 지원하는 브라우저를 흉내낸다 — jsdom에는 WebGL 컨텍스트가 아예 없다. */
function allowWebGL(context: unknown = {}) {
  vi.stubGlobal('WebGLRenderingContext', class {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as RenderingContext | null,
  )
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: reduce,
      removeEventListener: vi.fn(),
    }),
  )
}

function setSaveData(saveData: boolean) {
  Object.defineProperty(navigator, 'connection', {
    configurable: true,
    value: { saveData },
  })
}

describe('HeroCanvas', () => {
  beforeEach(() => {
    scenes.length = 0
    setReducedMotion(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, 'connection')
  })

  describe('3D를 포기하는 조건', () => {
    it('WebGL이 없는 브라우저에서는 three.js를 내려받지 않는다', async () => {
      render(<HeroCanvas game="yacht" />)

      await Promise.resolve()

      expect(scenes).toHaveLength(0)
    })

    it('WebGL 컨텍스트를 못 얻으면 포기한다', async () => {
      allowWebGL(null)

      render(<HeroCanvas game="yacht" />)
      await Promise.resolve()

      expect(scenes).toHaveLength(0)
    })

    it('getContext가 던지는 환경에서도 랜딩을 깨뜨리지 않는다', async () => {
      vi.stubGlobal('WebGLRenderingContext', class {})
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
        throw new Error('context creation blocked')
      })

      const view = render(<HeroCanvas game="yacht" />)
      await Promise.resolve()

      expect(scenes).toHaveLength(0)
      expect(view.container.firstElementChild).not.toBeNull()
    })

    it('모션 감소 설정에서는 정지 프레임 한 장을 위해 번들을 내려받지 않는다', async () => {
      allowWebGL()
      setReducedMotion(true)

      render(<HeroCanvas game="yacht" />)
      await Promise.resolve()

      expect(scenes).toHaveLength(0)
    })

    it('데이터 절약 모드에서도 장식을 건너뛴다 — 방 코드 입력이 먼저다', async () => {
      allowWebGL()
      setSaveData(true)

      render(<HeroCanvas game="yacht" />)
      await Promise.resolve()

      expect(scenes).toHaveLength(0)
    })

    it('데이터 절약 모드가 꺼져 있으면 정상 로드한다', async () => {
      allowWebGL()
      setSaveData(false)

      render(<HeroCanvas game="yacht" />)

      await waitFor(() => expect(scenes).toHaveLength(1))
    })
  })

  describe('씬 수명', () => {
    it('컴포넌트가 만든 div를 컨테이너로 넘겨 씬을 하나만 만든다', async () => {
      allowWebGL()

      const view = render(<HeroCanvas game="liars" />)

      await waitFor(() => expect(scenes).toHaveLength(1))
      expect(scenes[0]?.options.container).toBe(view.container.firstElementChild)
      expect(scenes[0]?.options.game).toBe('liars')
    })

    it('game prop이 바뀌면 씬을 새로 만들지 않고 교체만 요청한다', async () => {
      allowWebGL()
      const view = render(<HeroCanvas game="yacht" />)
      await waitFor(() => expect(scenes).toHaveLength(1))

      view.rerender(<HeroCanvas game="duel" />)
      view.rerender(<HeroCanvas game="fishing" />)

      expect(scenes).toHaveLength(1)
      expect(scenes[0]?.setGame.mock.calls.map(([game]) => game)).toEqual([
        'duel',
        'fishing',
      ] satisfies HeroGameKey[])
    })

    it('지연 로드가 끝나기 전에 game이 바뀌면 최신 game으로 만든다', async () => {
      allowWebGL()
      const view = render(<HeroCanvas game="yacht" />)

      // 아직 동적 import가 해결되지 않은 시점에 탭이 바뀌는 상황.
      expect(scenes).toHaveLength(0)
      view.rerender(<HeroCanvas game="pingpong" />)

      await waitFor(() => expect(scenes).toHaveLength(1))
      expect(scenes[0]?.options.game).toBe('pingpong')
      // 이미 최신 game으로 만들었으니 굳이 교체를 다시 요청하지 않는다.
      expect(scenes[0]?.setGame).not.toHaveBeenCalled()
    })

    it('지연 로드가 끝나기 전에 언마운트되면 씬을 만들지 않는다', async () => {
      allowWebGL()
      const view = render(<HeroCanvas game="yacht" />)

      view.unmount()
      await Promise.resolve()
      await Promise.resolve()

      expect(scenes).toHaveLength(0)
    })

    it('언마운트하면 씬을 해제한다 — 랜딩을 떠난 뒤 GPU 컨텍스트가 남지 않는다', async () => {
      allowWebGL()
      const view = render(<HeroCanvas game="yacht" />)
      await waitFor(() => expect(scenes).toHaveLength(1))

      view.unmount()

      expect(scenes[0]?.destroy).toHaveBeenCalledOnce()
    })

    it('해제한 뒤 오는 game 변경은 무시한다', async () => {
      allowWebGL()
      const view = render(<HeroCanvas game="yacht" />)
      await waitFor(() => expect(scenes).toHaveLength(1))

      view.unmount()

      expect(scenes[0]?.setGame).not.toHaveBeenCalled()
    })
  })
})
