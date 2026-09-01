import * as THREE from 'three'
import { afterEach, beforeEach, vi } from 'vitest'
import { createSizedContainer, FakeResizeObserver, FakeWebGLRenderer } from '@/test/threeStubs'
import { topFaceFromQuaternion } from '@/yacht/rendering/physics-dice/model'
import type {
  PhysicsDiceRollRequest,
  PhysicsDiceWorldCallbacks,
  PhysicsHeldDice,
} from '@/yacht/rendering/physics-dice/types'
import { PhysicsDiceWorld } from '@/yacht/rendering/physics-dice/World'

export const NONE_HELD: PhysicsHeldDice = [false, false, false, false, false]
export const FRAME_MS = 16

export function rollRequest(
  overrides: Partial<PhysicsDiceRollRequest> = {},
): PhysicsDiceRollRequest {
  return {
    held: NONE_HELD,
    requestId: 'roll-1',
    seed: 20260730,
    targetDice: [6, 2, 5, 1, 4],
    ...overrides,
  }
}

/**
 * 물리 주사위 월드 한 벌을 세우고 프레임을 손으로 돌리는 하네스. 렌더러·ResizeObserver는
 * 대역이고 시각도 가짜 타이머라, 이 하네스가 돌리는 판은 실제 시간과 무관하게 결정적이다.
 *
 * 헬퍼는 함수라 매 검사마다 다시 만들 필요가 없다 — 구조 분해해서 그대로 쓰면 된다.
 */
export function useWorld() {
  const created: PhysicsDiceWorld[] = []

  function callbackSpies(): PhysicsDiceWorldCallbacks {
    return {
      onError: vi.fn(),
      onHeldToggle: vi.fn(),
      onPhaseChange: vi.fn(),
      onResizeChange: vi.fn(),
      onRollComplete: vi.fn(),
    }
  }

  function build(width = 900, height = 640, quality: 'eco' | 'balanced' | 'high' = 'balanced') {
    const { container, resizeTo } = createSizedContainer(width, height)
    const callbacks = callbackSpies()
    const world = new PhysicsDiceWorld({ callbacks, container, quality })
    created.push(world)
    return { callbacks, container, resizeTo, world }
  }

  async function boot(width?: number, height?: number, quality?: 'eco' | 'balanced' | 'high') {
    const harness = build(width, height, quality)
    await harness.world.init()
    return harness
  }

  function runFrames(count: number) {
    for (let frame = 0; frame < count; frame += 1) vi.advanceTimersByTime(FRAME_MS)
  }

  function runUntil(condition: () => boolean, frames = 900) {
    for (let frame = 0; frame < frames && !condition(); frame += 1) {
      vi.advanceTimersByTime(FRAME_MS)
    }
    return condition()
  }

  function renderer() {
    const fake = FakeWebGLRenderer.last
    if (!fake) throw new Error('렌더러가 만들어지지 않았습니다.')
    return fake
  }

  function camera() {
    const found = scene().children.find(
      (child): child is THREE.OrthographicCamera => child instanceof THREE.OrthographicCamera,
    )
    const rendered = renderer().renders.at(-1)?.camera
    if (rendered instanceof THREE.OrthographicCamera) return rendered
    if (found) return found
    throw new Error('카메라를 찾을 수 없습니다.')
  }

  function scene() {
    const rendered = renderer().renders.at(-1)?.scene
    if (!(rendered instanceof THREE.Scene)) throw new Error('장면을 찾을 수 없습니다.')
    return rendered
  }

  function diceMeshes() {
    return scene()
      .children.filter(
        (child): child is THREE.Group =>
          child instanceof THREE.Group && typeof child.userData.dieIndex === 'number',
      )
      .sort((a, b) => Number(a.userData.dieIndex) - Number(b.userData.dieIndex))
  }

  function topFaces() {
    return diceMeshes().map((mesh) => topFaceFromQuaternion(mesh.quaternion))
  }

  function keepSlotBars() {
    return scene()
      .children.filter(
        (child): child is THREE.Group =>
          child instanceof THREE.Group &&
          child.userData.dieIndex === undefined &&
          child.children.length === 1 &&
          child.children[0] instanceof THREE.Mesh,
      )
      .sort((a, b) => a.position.x - b.position.x)
      .map((group) => group.children[0] as THREE.Mesh)
  }

  function bowlGroup() {
    const group = scene().children.find(
      (child): child is THREE.Group =>
        child instanceof THREE.Group &&
        child.userData.dieIndex === undefined &&
        child.children.length >= 3,
    )
    if (!group) throw new Error('사발 그룹을 찾을 수 없습니다.')
    return group
  }

  function pointerEventAt(position: THREE.Vector3) {
    const ndc = position.clone().project(camera())
    return new MouseEvent('pointerup', {
      bubbles: true,
      clientX: ((ndc.x + 1) / 2) * renderer().width,
      clientY: ((1 - ndc.y) / 2) * renderer().height,
    })
  }

  beforeEach(() => {
    FakeWebGLRenderer.reset()
    FakeResizeObserver.reset()
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('devicePixelRatio', 3)
    vi.useFakeTimers()
  })

  afterEach(() => {
    created.forEach((world) => {
      try {
        world.destroy()
      } catch {}
    })
    created.length = 0
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
    document.documentElement.removeAttribute('data-theme')
  })

  return {
    build,
    boot,
    runFrames,
    runUntil,
    renderer,
    camera,
    scene,
    diceMeshes,
    topFaces,
    keepSlotBars,
    bowlGroup,
    pointerEventAt,
  }
}
