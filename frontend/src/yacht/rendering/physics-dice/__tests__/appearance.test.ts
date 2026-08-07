import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeWebGLRenderer } from '@/test/threeStubs'
import {
  type AppearanceResources,
  disposeAppearance,
  syncAppearance,
} from '@/yacht/rendering/physics-dice/appearance'
import { createBowl, createKeepSlots, createTray } from '@/yacht/rendering/physics-dice/arena'
import { createDiceInstances } from '@/yacht/rendering/physics-dice/diceInstances'

const TOKENS = {
  '--ds-color-physics-accent': '#00ff00',
  '--ds-color-physics-danger': '#ff0000',
  '--ds-color-physics-die': '#ffffff',
  '--ds-color-physics-pip': '#000080',
  '--ds-color-physics-rail': '#123456',
  '--ds-color-physics-slot': '#654321',
} as const

/** documentElement의 CSS 커스텀 프로퍼티를 흉내낸다 — jsdom은 변수를 계산해 주지 않는다. */
function stubTokens(tokens: Record<string, string>) {
  return vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: (name: string) => tokens[name] ?? '',
  } as unknown as CSSStyleDeclaration)
}

function setup() {
  const scene = new THREE.Scene()
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 })
  const tray = createTray(scene, world)
  const bowl = createBowl(scene, world)
  const dice = createDiceInstances(scene, world)
  const slots = createKeepSlots(scene, dice.geometries)
  const renderer = new FakeWebGLRenderer()
  const resources: AppearanceResources = {
    ambient: new THREE.HemisphereLight(0xffffff, 0x1a1b1e, 1.65),
    bowlInnerMaterial: bowl.bowlInnerMaterial,
    bowlMaterials: bowl.bowlMaterials,
    entries: dice.entries,
    geometries: dice.geometries,
    keepSlotMaterials: slots.keepSlotMaterials,
    materials: dice.materials,
    railLineMaterial: tray.railLineMaterial,
    railMaterial: tray.railMaterial,
    trayMaterials: tray.trayMaterials,
  }
  return { renderer, resources, scene, world }
}

beforeAll(async () => {
  await RAPIER.init()
})

afterEach(() => {
  vi.restoreAllMocks()
  FakeWebGLRenderer.reset()
})

describe('syncAppearance', () => {
  it('디자인 토큰 색을 주사위·눈·레일 재질로 옮긴다', () => {
    stubTokens(TOKENS)
    const { resources, world } = setup()

    syncAppearance(resources)

    expect(resources.materials.die.color.getHexString()).toBe('ffffff')
    expect(resources.materials.dark.color.getHexString()).toBe('000080')
    expect(resources.materials.red.color.getHexString()).toBe('ff0000')
    expect(resources.railMaterial.color.getHexString()).toBe('123456')
    expect(resources.railLineMaterial.color.getHexString()).toBe('00ff00')
    world.free()
  })

  it('외곽선과 점유 슬롯이 같은 악센트 색을 쓴다 — 선택 표시의 색이 한 곳에서 나온다', () => {
    stubTokens(TOKENS)
    const { resources, world } = setup()

    syncAppearance(resources)

    const [occupied, empty] = resources.keepSlotMaterials
    resources.entries.forEach((entry) => {
      expect(entry.outline.material.color.getHexString()).toBe('00ff00')
    })
    expect((occupied as THREE.MeshBasicMaterial).color.getHexString()).toBe('00ff00')
    expect((empty as THREE.MeshBasicMaterial).color.getHexString()).toBe('654321')
    world.free()
  })

  it('사발 안쪽은 위험색을 어둡게 깐다 — 붉은 면이 주사위보다 튀지 않게', () => {
    stubTokens(TOKENS)
    const { resources, world } = setup()

    syncAppearance(resources)

    const inner = resources.bowlInnerMaterial.color
    const danger = new THREE.Color('#ff0000')
    expect(inner.r).toBeLessThan(danger.r)
    expect(inner.getHSL({ h: 0, s: 0, l: 0 }).h).toBeCloseTo(
      danger.getHSL({ h: 0, s: 0, l: 0 }).h,
      3,
    )
    world.free()
  })

  it('토큰이 아직 없어도 기본 색으로 채운다 — 테마 CSS가 늦어도 검은 무대가 되지 않는다', () => {
    stubTokens({})
    const { resources, world } = setup()

    syncAppearance(resources)

    expect(resources.materials.die.color.getHexString()).not.toBe('000000')
    expect(resources.railMaterial.color.getHexString()).not.toBe('000000')
    expect(resources.entries[0]?.outline.material.color.getHexString()).not.toBe('000000')
    world.free()
  })

  it('여러 번 호출해도 같은 결과다 — 테마 변경 감지가 매번 호출해도 색이 어두워지지 않는다', () => {
    stubTokens(TOKENS)
    const { resources, world } = setup()

    syncAppearance(resources)
    const once = resources.bowlInnerMaterial.color.clone()
    syncAppearance(resources)
    syncAppearance(resources)

    expect(resources.bowlInnerMaterial.color.getHex()).toBe(once.getHex())
    world.free()
  })
})

describe('disposeAppearance', () => {
  it('공유 자원을 정확히 한 번씩 버리고 렌더러 컨텍스트를 놓는다', () => {
    stubTokens(TOKENS)
    const { renderer, resources, scene, world } = setup()
    const disposables = [
      ...Object.values(resources.geometries),
      ...Object.values(resources.materials),
      ...resources.entries.map((entry) => entry.outline.material),
      ...resources.keepSlotMaterials,
      ...resources.bowlMaterials,
      ...resources.trayMaterials,
    ]
    const spies = disposables.map((target) => vi.spyOn(target, 'dispose'))

    disposeAppearance(resources, scene, renderer as unknown as THREE.WebGLRenderer)

    spies.forEach((spy) => {
      expect(spy).toHaveBeenCalledOnce()
    })
    expect(renderer.renderLists.dispose).toHaveBeenCalledOnce()
    expect(renderer.disposeCount).toBe(1)
    expect(renderer.contextLossCount).toBe(1)
    world.free()
  })

  it('장면에 남은 사발·판 지오메트리까지 버린다 — 주사위 지오메트리는 두 번 버리지 않는다', () => {
    stubTokens(TOKENS)
    const { renderer, resources, scene, world } = setup()
    const sharedSpy = vi.spyOn(resources.geometries.body, 'dispose')
    const sceneGeometries = new Set<THREE.BufferGeometry>()
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) sceneGeometries.add(object.geometry)
    })
    const otherSpies = [...sceneGeometries]
      .filter((geometry) => !Object.values(resources.geometries).includes(geometry as never))
      .map((geometry) => vi.spyOn(geometry, 'dispose'))

    disposeAppearance(resources, scene, renderer as unknown as THREE.WebGLRenderer)

    expect(sharedSpy).toHaveBeenCalledOnce()
    expect(otherSpies.length).toBeGreaterThan(0)
    otherSpies.forEach((spy) => {
      expect(spy).toHaveBeenCalledOnce()
    })
    world.free()
  })
})
