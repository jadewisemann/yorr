import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HeroGameKey } from '@/landing/landingGames'
import { HeroScene } from '@/landing/rendering/heroScene'
import {
  createSizedContainer,
  FakeResizeObserver,
  FakeWebGLRenderer,
  stubCanvas2dContext,
} from '@/test/threeStubs'

vi.mock('three', async (importOriginal) => {
  const { threeWithFakeRenderer } = await import('@/test/threeStubs')
  return threeWithFakeRenderer(importOriginal)
})

const ALL_GAMES: HeroGameKey[] = ['yacht', 'liars', 'duel', 'pingpong', 'fishing']

describe('HeroScene', () => {
  const scenes: HeroScene[] = []
  let canvasContext: ReturnType<typeof stubCanvas2dContext>

  function renderer() {
    const fake = FakeWebGLRenderer.last
    if (!fake) throw new Error('렌더러가 만들어지지 않았습니다.')
    return fake
  }

  function build(options: { game?: HeroGameKey; reducedMotion?: boolean } = {}) {
    const { container, resizeTo } = createSizedContainer(1200, 600)
    const scene = new HeroScene({
      container,
      game: options.game ?? 'yacht',
      ...(options.reducedMotion === undefined ? {} : { reducedMotion: options.reducedMotion }),
    })
    scenes.push(scene)
    return { container, resizeTo, scene }
  }

  /** 애니메이션 루프를 한 프레임 밟는다 — 실제 브라우저의 rAF 자리를 테스트가 대신한다. */
  function tick(ms = 40) {
    vi.advanceTimersByTime(ms)
    renderer().animationLoop?.()
  }

  function renderedScene() {
    const scene = renderer().renders.at(-1)?.scene
    if (!(scene instanceof THREE.Scene)) throw new Error('렌더된 장면이 없습니다.')
    return scene
  }

  function renderedCamera() {
    const camera = renderer().renders.at(-1)?.camera
    if (!(camera instanceof THREE.PerspectiveCamera)) throw new Error('렌더된 카메라가 없습니다.')
    return camera
  }

  /** 장면에서 무대 그룹을 꺼낸다 — 장면의 유일한 Group이다. */
  function stage() {
    const group = renderedScene().children.find(
      (child): child is THREE.Group => child instanceof THREE.Group,
    )
    if (!group) throw new Error('무대 그룹이 없습니다.')
    return group
  }

  function stageObject() {
    const object = stage().children[0]
    if (!(object instanceof THREE.Group)) throw new Error('무대 위 오브젝트가 없습니다.')
    return object
  }

  function meshesOf(object: THREE.Object3D) {
    const found: THREE.Mesh[] = []
    object.traverse((node) => {
      if (node instanceof THREE.Mesh) found.push(node)
    })
    return found
  }

  beforeEach(() => {
    FakeWebGLRenderer.reset()
    FakeResizeObserver.reset()
    canvasContext = stubCanvas2dContext()
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.useFakeTimers()
  })

  afterEach(() => {
    scenes.forEach((scene) => {
      scene.destroy()
    })
    scenes.length = 0
    canvasContext.restore()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  describe('마운트', () => {
    it('스크린리더에서 감춘 캔버스를 컨테이너에 채워 붙인다 — 순수 장식이다', () => {
      const { container } = build()

      const canvas = container.firstElementChild
      expect(container.children).toHaveLength(1)
      expect(canvas?.getAttribute('aria-hidden')).toBe('true')
      expect((canvas as HTMLCanvasElement).style.width).toBe('100%')
      expect((canvas as HTMLCanvasElement).style.height).toBe('100%')
    })

    it('면마다 다른 눈 텍스처를 그려 주사위 6면을 만든다', () => {
      build()

      // 1~6 눈을 각각 캔버스에 그린다 — 총 21개의 점.
      const drawnPips = canvasContext.calls.filter((call) => call === 'fill').length
      expect(drawnPips).toBe(21)
    })

    it('배경 위에 겹쳐 그리도록 알파를 켠 렌더러를 요청한다', () => {
      build()

      expect(renderer().parameters.alpha).toBe(true)
      expect(renderer().shadowMap.enabled).toBe(true)
    })

    it('세로 화면에서는 MSAA를 끈다 — 평평한 장면에서 값을 못 하는 비용이다', () => {
      vi.stubGlobal('innerWidth', 390)
      vi.stubGlobal('innerHeight', 844)

      build()

      expect(renderer().parameters.antialias).toBe(false)
    })
  })

  describe('애니메이션 루프', () => {
    it('30fps보다 빠른 프레임은 건너뛰고 간격을 모아 그린다 — 장식 장면이 열 예산을 먼저 태우지 않게', () => {
      build()
      tick(0)

      // 120Hz 단말처럼 8ms마다 프레임이 와도 30fps 간격(33ms)이 차기 전에는 그리지 않는다.
      tick(8)
      tick(8)
      tick(8)
      tick(8)
      expect(renderer().renders).toHaveLength(0)

      tick(8)
      expect(renderer().renders).toHaveLength(1)
    })

    it('등장 애니메이션이 아래에서 올라와 제 크기에 수렴한다', () => {
      build()

      tick(0)
      tick()
      const first = { scale: stageObject().scale.x, y: stageObject().position.y }
      for (let frame = 0; frame < 20; frame += 1) tick()

      expect(first.y).toBeLessThan(0)
      expect(first.scale).toBeLessThan(1)
      expect(stageObject().scale.x).toBeCloseTo(1, 3)
      expect(stageObject().position.y).toBeCloseTo(0, 3)
    })

    it('포인터를 움직이면 무대가 그 방향으로 서서히 기운다 — 즉시 점프하지 않는다', () => {
      build()
      tick()

      window.dispatchEvent(
        new MouseEvent('pointermove', {
          clientX: window.innerWidth,
          clientY: window.innerHeight,
        }),
      )
      tick()
      const firstStep = stage().rotation.y
      for (let frame = 0; frame < 40; frame += 1) tick()

      expect(firstStep).toBeGreaterThan(0)
      expect(stage().rotation.y).toBeGreaterThan(firstStep)
      expect(stage().rotation.x).toBeGreaterThan(0)
    })

    it('탭이 백그라운드로 가면 루프를 멈추고 돌아오면 다시 돈다', () => {
      build()
      tick()
      const rendered = renderer().renders.length
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)

      document.dispatchEvent(new Event('visibilitychange'))

      expect(renderer().animationLoop).toBeNull()

      hidden.mockReturnValue(false)
      document.dispatchEvent(new Event('visibilitychange'))
      tick()

      expect(renderer().animationLoop).not.toBeNull()
      expect(renderer().renders.length).toBeGreaterThan(rendered)
    })
  })

  describe('모션 감소 설정', () => {
    it('애니메이션 루프 없이 정지 프레임 한 장만 그린다', () => {
      build({ reducedMotion: true })

      expect(renderer().animationLoop).toBeNull()
      expect(renderer().renders.length).toBeGreaterThan(0)
      // 등장 애니메이션 없이 완성된 상태로 보여 준다.
      expect(stageObject().scale.x).toBeCloseTo(1, 6)
      expect(stageObject().position.y).toBeCloseTo(0, 6)
    })

    it('포인터 시차 효과를 아예 붙이지 않는다', () => {
      build({ reducedMotion: true })

      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1000, clientY: 900 }))

      expect(stage().rotation.y).toBe(0)
      expect(stage().rotation.x).toBe(0)
    })

    it('탭 전환에도 반응하지 않는다 — 멈출 루프가 없다', () => {
      build({ reducedMotion: true })
      const rendered = renderer().renders.length
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)

      document.dispatchEvent(new Event('visibilitychange'))

      expect(renderer().animationLoop).toBeNull()
      expect(renderer().renders.length).toBe(rendered)
    })

    it('OS 모션 감소 설정을 기본값으로 따른다', () => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn().mockReturnValue({ addEventListener: vi.fn(), matches: true }),
      )

      build()

      expect(renderer().animationLoop).toBeNull()
    })
  })

  describe('리사이즈', () => {
    it('세로 화면에서는 카메라를 뒤로 빼고 무대를 줄여 오브젝트가 잘리지 않게 한다', () => {
      const { resizeTo } = build({ reducedMotion: true })
      resizeTo(1200, 600)
      FakeResizeObserver.emitAll()
      const landscape = { scale: stage().scale.x, z: renderedCamera().position.z }

      resizeTo(390, 844)
      FakeResizeObserver.emitAll()

      expect(renderedCamera().position.z).toBeGreaterThan(landscape.z)
      expect(stage().scale.x).toBeLessThan(landscape.scale)
      expect(renderedCamera().aspect).toBeCloseTo(390 / 844, 6)
    })

    it('렌더 해상도와 카메라 종횡비가 컨테이너를 따라간다', () => {
      const { resizeTo } = build({ reducedMotion: true })

      resizeTo(800, 500)
      FakeResizeObserver.emitAll()

      expect(renderer().width).toBe(800)
      expect(renderer().height).toBe(500)
      expect(renderedCamera().aspect).toBeCloseTo(800 / 500, 6)
    })

    it('크기가 0인 컨테이너에서도 카메라 종횡비가 깨지지 않는다', () => {
      const { resizeTo } = build({ reducedMotion: true })

      resizeTo(0, 0)
      FakeResizeObserver.emitAll()

      expect(Number.isFinite(renderedCamera().aspect)).toBe(true)
      expect(renderedCamera().aspect).toBe(1)
    })
  })

  describe('게임 교체', () => {
    it.each(ALL_GAMES)('%s 게임의 오브젝트를 무대에 하나만 올린다', (game) => {
      build({ game, reducedMotion: true })

      expect(stage().children).toHaveLength(1)
      expect(meshesOf(stageObject()).length).toBeGreaterThan(0)
    })

    it('게임을 바꾸면 이전 오브젝트를 치우고 새 오브젝트만 남긴다', () => {
      const { scene } = build({ game: 'yacht', reducedMotion: true })
      const previous = stageObject()

      scene.setGame('duel')

      expect(stage().children).toHaveLength(1)
      expect(stageObject()).not.toBe(previous)
      expect(previous.parent).toBeNull()
    })

    it('주사위 지오메트리·재질은 게임을 바꿔도 살아남아 다시 업로드되지 않는다', () => {
      const { scene } = build({ game: 'yacht', reducedMotion: true })
      const firstDie = meshesOf(stageObject())[0]
      if (!firstDie) throw new Error('주사위 메시가 없습니다.')
      const geometry = firstDie.geometry
      const material = firstDie.material

      scene.setGame('duel')
      scene.setGame('yacht')

      const revisited = meshesOf(stageObject())[0]
      expect(revisited?.geometry).toBe(geometry)
      expect(revisited?.material).toBe(material)
    })

    it('교체된 오브젝트의 전용 지오메트리는 버린다 — 게임을 오래 바꿔도 메모리가 늘지 않는다', () => {
      const { scene } = build({ game: 'duel', reducedMotion: true })
      const spies = meshesOf(stageObject()).map((mesh) => vi.spyOn(mesh.geometry, 'dispose'))

      scene.setGame('yacht')

      expect(spies.length).toBeGreaterThan(0)
      spies.forEach((spy) => {
        expect(spy).toHaveBeenCalled()
      })
    })

    it('모션 감소 설정에서는 교체 즉시 새 오브젝트를 그린 프레임을 남긴다', () => {
      const { scene } = build({ game: 'yacht', reducedMotion: true })
      const rendered = renderer().renders.length

      scene.setGame('fishing')

      expect(renderer().renders.length).toBeGreaterThan(rendered)
    })
  })

  describe('해제', () => {
    it('캔버스를 떼고 컨텍스트를 놓고 루프를 멈춘다', () => {
      const { container, scene } = build()
      tick()

      scene.destroy()

      expect(container.children).toHaveLength(0)
      expect(renderer().animationLoop).toBeNull()
      expect(renderer().disposeCount).toBe(1)
      expect(renderer().contextLossCount).toBe(1)
    })

    it('두 번 해제해도 자원을 두 번 놓지 않는다', () => {
      const { scene } = build()

      scene.destroy()
      scene.destroy()

      expect(renderer().disposeCount).toBe(1)
      expect(renderer().contextLossCount).toBe(1)
    })

    it('해제 후에는 포인터·탭 전환·게임 교체가 아무 일도 하지 않는다', () => {
      const { scene } = build()
      tick()
      scene.destroy()
      const rendered = renderer().renders.length

      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }))
      document.dispatchEvent(new Event('visibilitychange'))
      scene.setGame('liars')

      expect(renderer().renders.length).toBe(rendered)
      expect(renderer().animationLoop).toBeNull()
    })
  })
})
