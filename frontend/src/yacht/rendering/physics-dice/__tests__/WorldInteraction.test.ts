import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { FakeResizeObserver } from '@/test/threeStubs'
import { PHYSICS_DICE_CONFIG } from '@/yacht/rendering/physics-dice/config'
import { keepSlotSpacing, resultCameraWidth } from '@/yacht/rendering/physics-dice/layout'
import type { PhysicsDiceIndex, PhysicsHeldDice } from '@/yacht/rendering/physics-dice/types'
import { FRAME_MS, rollRequest, useWorld } from './worldHarness'

// `vi.mock`은 부른 파일에만 걸린다 — 하네스로 옮길 수 없다.
vi.mock('three', async (importOriginal) => {
  const { threeWithFakeRenderer } = await import('@/test/threeStubs')
  return threeWithFakeRenderer(importOriginal)
})

const CONFIG = PHYSICS_DICE_CONFIG
const SCENE = CONFIG.scene

const { boot, runFrames, renderer, camera, diceMeshes, bowlGroup, pointerEventAt } = useWorld()

describe('PhysicsDiceWorld — 입력과 화면 변화', () => {
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
