import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSizedContainer, FakeResizeObserver, FakeWebGLRenderer } from '@/test/threeStubs'
import { PHYSICS_DICE_CONFIG } from './config'
import { keepSlotPosition, keepSlotSpacing, resultCameraWidth } from './layout'
import { topFaceFromQuaternion } from './model'
import type {
  PhysicsDiceIndex,
  PhysicsDiceRollRequest,
  PhysicsDiceSet,
  PhysicsDiceWorldCallbacks,
  PhysicsHeldDice,
} from './types'
import { PhysicsDiceWorld } from './World'

vi.mock('three', async (importOriginal) => {
  const { threeWithFakeRenderer } = await import('@/test/threeStubs')
  return threeWithFakeRenderer(importOriginal)
})

const SCENE = PHYSICS_DICE_CONFIG.scene
const NONE_HELD: PhysicsHeldDice = [false, false, false, false, false]
const FRAME_MS = 16

function rollRequest(overrides: Partial<PhysicsDiceRollRequest> = {}): PhysicsDiceRollRequest {
  return {
    held: NONE_HELD,
    requestId: 'roll-1',
    seed: 20260730,
    targetDice: [6, 2, 5, 1, 4],
    ...overrides,
  }
}

it('Rapier 강체가 원본 중력과 재질 설정에서 바닥에 안착한다', async () => {
  await RAPIER.init()
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 })
  world.timestep = 1 / 60
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(4, 0.1, 2).setTranslation(0, -0.1, 0).setFriction(0.8),
  )
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 3, 0)
      .setLinearDamping(0.16)
      .setAngularDamping(0.2),
  )
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.43, 0.43, 0.43).setRestitution(0.34).setFriction(0.74),
    body,
  )
  body.setAngvel({ x: 8, y: 5, z: -7 }, true)

  for (let frame = 0; frame < 600; frame += 1) world.step()

  expect(body.translation().y).toBeGreaterThan(0.35)
  expect(body.translation().y).toBeLessThan(0.6)
  expect(Math.hypot(body.linvel().x, body.linvel().y, body.linvel().z)).toBeLessThan(0.05)
  world.free()
})

describe('PhysicsDiceWorld', () => {
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

  /** 프레임을 실제로 밟는다 — rAF·performance.now는 모두 가짜 시계에 묶여 있다. */
  function runFrames(count: number) {
    for (let frame = 0; frame < count; frame += 1) vi.advanceTimersByTime(FRAME_MS)
  }

  /** 조건이 만족될 때까지(최대 frames) 프레임을 밟는다. */
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
    // 카메라는 장면에 추가되지 않으므로 마지막 render 인자에서 꺼낸다.
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

  /** 장면에서 주사위 메시(그룹)를 인덱스 순으로 모은다 — World가 내부를 노출하지 않기 때문이다. */
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

  function bowlGroup() {
    // 사발은 카메라 밖 유일한 THREE.Group 중 dieIndex가 없는 것이다.
    const group = scene().children.find(
      (child): child is THREE.Group =>
        child instanceof THREE.Group &&
        child.userData.dieIndex === undefined &&
        child.children.length >= 3,
    )
    if (!group) throw new Error('사발 그룹을 찾을 수 없습니다.')
    return group
  }

  /** 월드 좌표를 캔버스 위 포인터 이벤트로 바꾼다. */
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
    // 고DPI 기기를 가정한다 — 품질 프리셋의 상한이 실제로 걸리는지 보려면 1보다 커야 한다.
    vi.stubGlobal('devicePixelRatio', 3)
    vi.useFakeTimers()
  })

  afterEach(() => {
    created.forEach((world) => {
      // 테스트가 이미 해제했을 수 있다 — destroy는 두 번 호출하면 Rapier 월드에서 던진다.
      try {
        world.destroy()
      } catch {
        /* 이미 해제된 월드 */
      }
    })
    created.length = 0
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
    document.documentElement.removeAttribute('data-theme')
  })

  describe('초기화와 해제', () => {
    it('캔버스를 컨테이너에 붙이고 첫 프레임에 주사위 5개를 결과 줄에 세운다', async () => {
      const { container } = await boot()

      runFrames(1)

      expect(container.children).toHaveLength(1)
      expect(renderer().renders.length).toBeGreaterThan(0)
      const meshes = diceMeshes()
      expect(meshes).toHaveLength(5)
      meshes.forEach((mesh) => {
        expect(mesh.visible).toBe(true)
        expect(mesh.position.z).toBeCloseTo(SCENE.tray.resultRowZ, 5)
      })
      // 가운데 주사위가 화면 중앙 — 결과 줄은 항상 중앙 정렬이다.
      expect(meshes[2]?.position.x).toBeCloseTo(0, 5)
    })

    it('초기화 전에 받은 확정 주사위가 첫 프레임에 그대로 보인다', async () => {
      const dice: PhysicsDiceSet = [2, 4, 6, 1, 3]
      const { world } = build()

      world.syncCommittedDice(dice, NONE_HELD)
      await world.init()
      runFrames(1)

      expect(topFaces()).toEqual([...dice])
    })

    it('초기화 전 startRoll·applyQuality는 아무 일도 하지 않는다 — 지연 로딩 중 눌러도 안전하다', () => {
      const { callbacks, world } = build()

      expect(() => {
        world.applyQuality('high')
        world.startRoll(rollRequest())
        world.pour()
      }).not.toThrow()
      expect(callbacks.onPhaseChange).not.toHaveBeenCalled()
    })

    it('해제하면 컨테이너를 비우고 렌더러 컨텍스트를 놓고 프레임을 멈춘다', async () => {
      const { callbacks, container, world } = await boot()
      runFrames(2)
      const rendered = renderer().renders.length

      world.destroy()
      runFrames(10)

      expect(container.children).toHaveLength(0)
      expect(renderer().disposeCount).toBe(1)
      expect(renderer().contextLossCount).toBe(1)
      expect(renderer().renders.length).toBe(rendered)
      // 해제 시 "3D 조정 중" 오버레이가 남으면 화면이 영구히 가려진다.
      expect(callbacks.onResizeChange).toHaveBeenLastCalledWith(false)
    })

    it('초기화하지 않은 월드를 해제해도 예외가 없다', () => {
      const { world } = build()

      expect(() => world.destroy()).not.toThrow()
    })
  })

  describe('syncCommittedDice', () => {
    it('확정값을 바꾸면 굴리지 않고도 곧바로 그 눈이 보인다', async () => {
      const { world } = await boot()

      world.syncCommittedDice([1, 1, 3, 3, 5], NONE_HELD)
      runFrames(1)

      expect(topFaces()).toEqual([1, 1, 3, 3, 5])
    })

    it('킵을 켜면 킵 순서대로 슬롯까지 애니메이션으로 이동한다', async () => {
      const { world } = await boot()
      world.syncCommittedDice([1, 2, 3, 4, 5], NONE_HELD)
      runFrames(1)
      const before = diceMeshes()[2]?.position.clone() ?? new THREE.Vector3()

      world.syncCommittedDice(null, [false, false, true, false, false])
      runFrames(2)
      const midway = diceMeshes()[2]?.position.clone() ?? new THREE.Vector3()

      // 애니메이션 중간에는 출발점도, 목표점도 아니다.
      expect(midway.distanceTo(before)).toBeGreaterThan(0)
      expect(midway.x).toBeGreaterThan(keepSlotPosition(0).x)

      runFrames(SCENE.keepSlots.moveDurationMs / FRAME_MS + 4)

      expect(diceMeshes()[2]?.position.x).toBeCloseTo(keepSlotPosition(0).x, 4)
      expect(diceMeshes()[2]?.position.z).toBeGreaterThan(SCENE.tray.separatorZ)
    })

    it('킵 순서를 기억한다 — 먼저 킵한 주사위가 왼쪽 슬롯에 남는다', async () => {
      const { world } = await boot()

      world.syncCommittedDice([1, 2, 3, 4, 5], [false, false, false, true, false])
      world.syncCommittedDice(null, [true, false, false, true, false])
      runFrames(40)

      const meshes = diceMeshes()
      expect(meshes[3]?.position.x).toBeCloseTo(keepSlotPosition(0).x, 4)
      expect(meshes[0]?.position.x).toBeCloseTo(keepSlotPosition(1).x, 4)
    })

    it('킵을 풀면 그 주사위만 결과 줄로 돌아가고 남은 킵은 슬롯을 앞으로 당긴다', async () => {
      const { world } = await boot()
      world.syncCommittedDice([1, 2, 3, 4, 5], [true, false, true, false, false])
      runFrames(40)

      world.syncCommittedDice(null, [false, false, true, false, false])
      runFrames(40)

      const meshes = diceMeshes()
      expect(meshes[2]?.position.x).toBeCloseTo(keepSlotPosition(0).x, 4)
      expect(meshes[0]?.position.z).toBeCloseTo(SCENE.tray.resultRowZ, 4)
    })

    it('굴리는 중에는 배치를 바꾸지 않는다 — 사발 안 주사위가 갑자기 레일로 튀지 않는다', async () => {
      const { world } = await boot()
      world.startRoll(rollRequest())
      runFrames(3)
      const before = diceMeshes().map((mesh) => mesh.position.clone())

      world.syncCommittedDice([1, 1, 1, 1, 1], [true, true, false, false, false])

      const after = diceMeshes().map((mesh) => mesh.position.clone())
      after.forEach((position, index) => {
        expect(position.distanceTo(before[index] ?? new THREE.Vector3())).toBe(0)
      })
    })
  })

  describe('startRoll', () => {
    it('흔들기 단계로 들어가며 사발을 띄우고 주사위를 사발 안에 담는다', async () => {
      const { callbacks, world } = await boot()

      world.startRoll(rollRequest())
      runFrames(1)

      expect(callbacks.onPhaseChange).toHaveBeenCalledWith('shaking')
      expect(bowlGroup().visible).toBe(true)
      diceMeshes().forEach((mesh) => {
        const radius = Math.hypot(
          mesh.position.x - SCENE.bowl.startX,
          mesh.position.z - SCENE.bowl.startZ,
        )
        expect(radius).toBeLessThan(SCENE.bowl.containmentRadius)
        expect(mesh.position.y).toBeGreaterThan(SCENE.bowl.hoverY)
      })
    })

    it('같은 requestId를 다시 보내도 굴림을 다시 시작하지 않는다', async () => {
      const { callbacks, world } = await boot()
      const request = rollRequest()

      world.startRoll(request)
      runFrames(2)
      const positions = diceMeshes().map((mesh) => mesh.position.clone())
      world.startRoll(request)

      expect(callbacks.onPhaseChange).toHaveBeenCalledTimes(1)
      diceMeshes().forEach((mesh, index) => {
        expect(mesh.position.distanceTo(positions[index] ?? new THREE.Vector3())).toBe(0)
      })
    })

    it('킵한 주사위는 사발에 담지 않고 슬롯에 확정값으로 고정해 둔다', async () => {
      const { world } = await boot()
      world.syncCommittedDice([1, 2, 3, 4, 5], NONE_HELD)
      const held: PhysicsHeldDice = [false, true, false, false, true]

      world.startRoll(rollRequest({ held, targetDice: [6, 2, 6, 6, 5] }))
      runFrames(30)

      const meshes = diceMeshes()
      expect(meshes[1]?.position.x).toBeCloseTo(keepSlotPosition(0).x, 4)
      expect(meshes[4]?.position.x).toBeCloseTo(keepSlotPosition(1).x, 4)
      // 킵한 주사위 눈은 흔드는 동안에도 확정값 그대로다.
      expect(topFaceFromQuaternion(meshes[1]?.quaternion ?? new THREE.Quaternion())).toBe(2)
      expect(topFaceFromQuaternion(meshes[4]?.quaternion ?? new THREE.Quaternion())).toBe(5)
    })

    it('같은 seed는 같은 스폰 배치를 만든다 — 재접속 후에도 같은 굴림을 재현할 수 있다', async () => {
      const first = await boot()
      first.world.startRoll(rollRequest())
      runFrames(1)
      const firstPositions = diceMeshes().map((mesh) => mesh.position.clone())

      const second = await boot()
      second.world.startRoll(rollRequest())
      runFrames(1)
      const secondPositions = diceMeshes().map((mesh) => mesh.position.clone())

      secondPositions.forEach((position, index) => {
        expect(position.distanceTo(firstPositions[index] ?? new THREE.Vector3())).toBeLessThan(1e-9)
      })
    })
  })

  describe('굴림 완료', () => {
    it('흔들기 → 쏟기 → 정렬을 거쳐 목표 눈으로 마무리한다', async () => {
      const { callbacks, world } = await boot()
      const request = rollRequest({ targetDice: [3, 6, 1, 4, 2] })

      world.startRoll(request)
      runFrames(30)
      world.pour()
      const finished = runUntil(
        () => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      )

      expect(finished).toBe(true)
      expect(callbacks.onPhaseChange).toHaveBeenNthCalledWith(1, 'shaking')
      expect(callbacks.onPhaseChange).toHaveBeenNthCalledWith(2, 'pouring')
      expect(callbacks.onPhaseChange).toHaveBeenNthCalledWith(3, 'aligning')
      expect(callbacks.onPhaseChange).toHaveBeenLastCalledWith('idle')
      expect(callbacks.onRollComplete).toHaveBeenCalledWith(request.requestId, [
        ...request.targetDice,
      ])
      // 화면에 보이는 눈이 곧 결과다 — 여기가 어긋나면 점수와 그림이 다르게 보인다.
      expect(topFaces()).toEqual([...request.targetDice])
    })

    it('굴림이 끝나면 결과 줄에 서고 사발은 화면에서 사라진다', async () => {
      const { callbacks, world } = await boot()

      world.startRoll(rollRequest())
      runFrames(30)
      world.pour()
      runUntil(() => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 0)

      expect(bowlGroup().visible).toBe(false)
      diceMeshes().forEach((mesh) => {
        expect(mesh.position.z).toBeCloseTo(SCENE.tray.resultRowZ, 4)
        expect(Math.abs(mesh.position.x)).toBeLessThan(resultCameraWidth())
      })
    })

    it('굴림 결과가 확정값으로 남아 다시 동기화해도 눈이 바뀌지 않는다', async () => {
      const { callbacks, world } = await boot()
      const request = rollRequest({ requestId: 'roll-baked', targetDice: [5, 5, 2, 3, 6] })

      world.startRoll(request)
      runFrames(30)
      world.pour()
      runUntil(() => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 0)
      // 서버가 같은 값을 되돌려 주는 상황 — 보정 오프셋이 남아 있으면 여기서 눈이 튄다.
      world.syncCommittedDice(null, NONE_HELD)
      runFrames(2)

      expect(topFaces()).toEqual([...request.targetDice])
    })

    it('굴림이 끝난 뒤에는 다음 requestId로 다시 굴릴 수 있다', async () => {
      const { callbacks, world } = await boot()
      world.startRoll(rollRequest({ requestId: 'roll-1' }))
      runFrames(30)
      world.pour()
      runUntil(() => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 0)

      world.startRoll(rollRequest({ requestId: 'roll-2', seed: 99, targetDice: [1, 1, 1, 1, 1] }))
      runFrames(30)
      world.pour()
      const finished = runUntil(
        () => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 1,
      )

      expect(finished).toBe(true)
      expect(topFaces()).toEqual([1, 1, 1, 1, 1])
    })

    it('pour는 흔들기 중에만 듣는다 — idle에서 눌러도 굴림이 시작되지 않는다', async () => {
      const { callbacks, world } = await boot()

      world.pour()
      runFrames(5)

      expect(callbacks.onPhaseChange).not.toHaveBeenCalled()
      expect(callbacks.onRollComplete).not.toHaveBeenCalled()
    })
  })

  describe('흔들림 펄스', () => {
    it('follow 모드가 아니면 펄스를 무시한다 — tap 모드는 자체 리듬으로 흔든다', async () => {
      const { world } = await boot()
      world.startRoll(rollRequest())
      runFrames(2)
      const before = diceMeshes().map((mesh) => mesh.position.clone())

      world.applyShakePulse('left', 1)

      diceMeshes().forEach((mesh, index) => {
        expect(mesh.position.distanceTo(before[index] ?? new THREE.Vector3())).toBe(0)
      })
    })

    it('follow 모드에서는 펄스가 없으면 사발이 잦아들고, 펄스를 주면 다시 흔들린다', async () => {
      const { world } = await boot()
      world.setMotionFollow(true)
      world.startRoll(rollRequest())

      // followDecayMs를 훌쩍 넘겨 흔들림 에너지를 모두 소진시킨다.
      runFrames(120)
      const quiet = bowlGroup().position.clone()

      world.applyShakePulse('right', 1)
      runFrames(3)

      expect(quiet.x).toBeCloseTo(SCENE.bowl.startX, 4)
      expect(quiet.z).toBeCloseTo(SCENE.bowl.startZ, 4)
      expect(bowlGroup().position.distanceTo(quiet)).toBeGreaterThan(0)
    })

    it('펄스는 굴릴 주사위만 움직이고 킵한 주사위는 슬롯에 붙어 있다', async () => {
      const { world } = await boot()
      world.setMotionFollow(true)
      const held: PhysicsHeldDice = [true, false, false, false, false]
      world.startRoll(rollRequest({ held }))
      runFrames(2)
      const heldBefore = diceMeshes()[0]?.position.clone() ?? new THREE.Vector3()
      const rollingBefore = diceMeshes()[1]?.position.clone() ?? new THREE.Vector3()

      world.applyShakePulse('left', 1)
      runFrames(4)

      expect(diceMeshes()[0]?.position.distanceTo(heldBefore)).toBe(0)
      expect(diceMeshes()[1]?.position.distanceTo(rollingBefore)).toBeGreaterThan(0)
    })

    it('흔들기 단계가 아니면 펄스를 무시한다 — idle에서 흔들어도 사발이 나오지 않는다', async () => {
      const { world } = await boot()
      runFrames(1)
      world.setMotionFollow(true)

      expect(() => world.applyShakePulse('left', 2)).not.toThrow()
      expect(bowlGroup().visible).toBe(false)
    })
  })

  describe('applyQuality', () => {
    it('eco는 그림자를 끄고 픽셀 비율을 1로 낮춘다', async () => {
      const { world } = await boot()

      world.applyQuality('eco')

      expect(renderer().shadowMap.enabled).toBe(false)
      expect(renderer().pixelRatio).toBe(PHYSICS_DICE_CONFIG.quality.eco.pixelRatio)
    })

    it('품질을 올려도 기기 픽셀 비율 상한을 넘지 않는다 — 고DPI에서 GPU가 타지 않게', async () => {
      const { world } = await boot(900, 640, 'eco')

      world.applyQuality('high')

      expect(renderer().shadowMap.enabled).toBe(true)
      expect(renderer().pixelRatio).toBe(PHYSICS_DICE_CONFIG.quality.high.pixelRatio)
      expect(renderer().pixelRatio).toBeLessThan(window.devicePixelRatio)
    })

    it('품질을 낮추면 픽셀 비율도 함께 내려간다', async () => {
      const { world } = await boot(900, 640, 'high')

      world.applyQuality('balanced')

      expect(renderer().pixelRatio).toBe(PHYSICS_DICE_CONFIG.quality.balanced.pixelRatio)
    })

    it('품질을 바꿔도 화면 크기와 카메라는 유지된다', async () => {
      const { world } = await boot(900, 640)
      const before = { height: renderer().height, width: renderer().width }

      world.applyQuality('eco')

      expect(renderer().width).toBe(before.width)
      expect(renderer().height).toBe(before.height)
    })
  })

  describe('resize', () => {
    it('어떤 비율에서도 화면 픽셀이 정사각이다 — 주사위가 찌그러지지 않는다', async () => {
      const { resizeTo, world } = await boot(900, 640)

      for (const [width, height] of [
        [1600, 600],
        [700, 900],
        [240, 900],
      ] as const) {
        resizeTo(width, height)
        world.resize()
        runFrames(1)

        expect(camera().right / camera().top).toBeCloseTo(width / height, 5)
        expect(camera().left).toBeCloseTo(-camera().right, 6)
        expect(camera().bottom).toBeCloseTo(-camera().top, 6)
      }
    })

    it('아주 좁은 화면에서도 킵 슬롯 5개가 화면 안에 들어온다', async () => {
      const { resizeTo, world } = await boot(900, 640)
      const outerSlotEdge =
        2 * keepSlotSpacing() +
        (PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.keepSlots.diceScale) / 2

      resizeTo(240, 900)
      world.resize()
      runFrames(1)

      expect(camera().right).toBeGreaterThanOrEqual(outerSlotEdge)
    })

    it('세로로 긴 화면은 빈 바닥을 늘리는 대신 좌우 가장자리를 잘라낸다', async () => {
      const { resizeTo, world } = await boot(900, 640)

      resizeTo(700, 900)
      world.resize()
      runFrames(1)

      expect(camera().top).toBeCloseTo(SCENE.camera.maxHalfHeight, 6)
      expect(camera().right).toBeLessThan(resultCameraWidth())
    })

    it('가로로 넓은 화면은 세로를 최소 높이로 유지하고 좌우로만 넓힌다', async () => {
      const { resizeTo, world } = await boot(900, 640)

      resizeTo(1600, 600)
      world.resize()
      runFrames(1)

      expect(camera().top).toBeCloseTo(SCENE.camera.minHalfHeight, 6)
      expect(camera().right).toBeGreaterThan(resultCameraWidth())
    })

    it('렌더 해상도는 컨테이너 크기를 따라간다', async () => {
      const { resizeTo, world } = await boot(900, 640)

      resizeTo(1024, 768)
      world.resize()

      expect(renderer().width).toBe(1024)
      expect(renderer().height).toBe(768)
    })
  })

  describe('컨테이너 크기 변화 대응', () => {
    it('배너가 들어오는 정도의 작은 변화는 멈춤 없이 즉시 반영한다', async () => {
      const { callbacks, resizeTo } = await boot(900, 640)

      resizeTo(900, 560)
      FakeResizeObserver.emitAll()
      runFrames(1)

      expect(callbacks.onResizeChange).not.toHaveBeenCalledWith(true)
      expect(renderer().height).toBe(560)
    })

    it('회전처럼 큰 변화는 "조정 중"을 켜고 잦아든 뒤 한 번에 다시 맞춘다', async () => {
      const { callbacks, resizeTo } = await boot(900, 640)

      resizeTo(500, 1000)
      FakeResizeObserver.emitAll()

      expect(callbacks.onResizeChange).toHaveBeenCalledWith(true)
      expect(renderer().width).toBe(900)

      vi.advanceTimersByTime(200)

      expect(renderer().width).toBe(500)
      expect(callbacks.onResizeChange).toHaveBeenLastCalledWith(false)
    })

    it('큰 변화가 연달아 오면 마지막 크기로 한 번만 다시 맞춘다', async () => {
      const { callbacks, resizeTo } = await boot(900, 640)

      resizeTo(500, 1000)
      FakeResizeObserver.emitAll()
      vi.advanceTimersByTime(100)
      resizeTo(420, 1000)
      FakeResizeObserver.emitAll()
      vi.advanceTimersByTime(200)

      expect(renderer().width).toBe(420)
      expect(callbacks.onResizeChange).toHaveBeenLastCalledWith(false)
      expect(
        (callbacks.onResizeChange as ReturnType<typeof vi.fn>).mock.calls.filter(
          ([resizing]) => resizing === false,
        ),
      ).toHaveLength(1)
    })

    it('크기가 그대로면 아무 일도 하지 않는다', async () => {
      const { callbacks } = await boot(900, 640)
      runFrames(2)
      const rendered = renderer().renders.length

      FakeResizeObserver.emitAll()
      runFrames(1)

      expect(callbacks.onResizeChange).not.toHaveBeenCalled()
      expect(renderer().renders.length).toBe(rendered)
    })

    it('해제한 뒤 오는 크기 변화 통지는 무시한다', async () => {
      const { callbacks, resizeTo, world } = await boot(900, 640)
      world.destroy()
      ;(callbacks.onResizeChange as ReturnType<typeof vi.fn>).mockClear()

      resizeTo(400, 1000)
      FakeResizeObserver.emitAll()
      vi.advanceTimersByTime(300)

      expect(callbacks.onResizeChange).not.toHaveBeenCalled()
    })
  })

  describe('주사위 탭', () => {
    it('주사위를 탭하면 그 인덱스로 킵 토글을 알린다', async () => {
      const { callbacks } = await boot()
      runFrames(1)
      const meshes = diceMeshes()

      meshes.forEach((mesh) => {
        renderer().domElement.dispatchEvent(pointerEventAt(mesh.position))
      })

      expect(
        (callbacks.onHeldToggle as ReturnType<typeof vi.fn>).mock.calls.map(([index]) => index),
      ).toEqual([0, 1, 2, 3, 4] satisfies PhysicsDiceIndex[])
    })

    it('빈 곳을 탭하면 아무 것도 토글하지 않는다', async () => {
      const { callbacks } = await boot()
      runFrames(1)

      renderer().domElement.dispatchEvent(
        pointerEventAt(new THREE.Vector3(0, 0.5, SCENE.tray.rollingMinZ)),
      )

      expect(callbacks.onHeldToggle).not.toHaveBeenCalled()
    })

    it('굴리는 중에는 탭을 받지 않는다 — 사발 안 주사위를 킵할 수는 없다', async () => {
      const { callbacks, world } = await boot()
      runFrames(1)
      const positions = diceMeshes().map((mesh) => mesh.position.clone())

      world.startRoll(rollRequest())
      runFrames(1)
      positions.forEach((position) => {
        renderer().domElement.dispatchEvent(pointerEventAt(position))
      })

      expect(callbacks.onHeldToggle).not.toHaveBeenCalled()
    })

    it('해제한 뒤 캔버스에 남은 탭 이벤트는 콜백을 부르지 않는다', async () => {
      const { callbacks, world } = await boot()
      runFrames(1)
      const target = diceMeshes()[0]?.position.clone() ?? new THREE.Vector3()
      const event = pointerEventAt(target)

      world.destroy()
      renderer().domElement.dispatchEvent(event)

      expect(callbacks.onHeldToggle).not.toHaveBeenCalled()
    })
  })

  describe('테마 변경', () => {
    it('문서 테마 속성이 바뀌면 색을 다시 읽어 한 프레임 더 그린다', async () => {
      await boot()
      runFrames(2)
      const rendered = renderer().renders.length

      document.documentElement.setAttribute('data-theme', 'dark')
      await vi.advanceTimersByTimeAsync(FRAME_MS * 2)

      expect(renderer().renders.length).toBeGreaterThan(rendered)
    })
  })
})
