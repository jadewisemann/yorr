import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { PHYSICS_DICE_CONFIG } from '@/yacht/rendering/physics-dice/config'
import { keepSlotPosition, resultCameraWidth } from '@/yacht/rendering/physics-dice/layout'
import { topFaceFromQuaternion } from '@/yacht/rendering/physics-dice/model'
import type { PhysicsDiceSet, PhysicsHeldDice } from '@/yacht/rendering/physics-dice/types'
import { FRAME_MS, installWorld, NONE_HELD, rollRequest } from './worldHarness'

// `vi.mock`은 부른 파일에만 걸린다 — 하네스로 옮길 수 없다.
vi.mock('three', async (importOriginal) => {
  const { threeWithFakeRenderer } = await import('@/test/threeStubs')
  return threeWithFakeRenderer(importOriginal)
})

const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene

const {
  build,
  boot,
  runFrames,
  runUntil,
  renderer,
  diceMeshes,
  topFaces,
  keepSlotBars,
  bowlGroup,
} = installWorld()

describe('PhysicsDiceWorld — 수명주기와 굴림', () => {
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

    it('keepAll에서 레일 바는 주사위가 도착한 뒤에 켜진다', async () => {
      const { callbacks, world } = await boot()
      const held: PhysicsHeldDice = [true, true, false, false, false]
      world.syncCommittedDice([6, 6, 2, 3, 5], held)
      world.setKeepAll(true)
      world.startRoll(rollRequest({ held, targetDice: [6, 6, 6, 6, 2] }))
      runFrames(30)
      world.pour()
      runUntil(() => (callbacks.onPhaseChange as ReturnType<typeof vi.fn>).mock.calls.length >= 3)

      const flying = keepSlotBars()
      expect(flying[0]?.material).not.toBe(flying[4]?.material)

      runUntil(() => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 0)

      const landed = keepSlotBars()
      expect(landed[4]?.material).toBe(landed[0]?.material)
    })

    it('굴림 결과가 확정값으로 남아 다시 동기화해도 눈이 바뀌지 않는다', async () => {
      const { callbacks, world } = await boot()
      const request = rollRequest({ requestId: 'roll-baked', targetDice: [5, 5, 2, 3, 6] })

      world.startRoll(request)
      runFrames(30)
      world.pour()
      runUntil(() => (callbacks.onRollComplete as ReturnType<typeof vi.fn>).mock.calls.length > 0)
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
})
