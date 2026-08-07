import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { PHYSICS_DICE_CONFIG } from '@/yacht/rendering/physics-dice/config'
import { createDiceInstances } from '@/yacht/rendering/physics-dice/diceInstances'

describe('createDiceInstances', () => {
  beforeAll(async () => {
    await RAPIER.init()
  })

  function setup() {
    const scene = new THREE.Scene()
    const world = new RAPIER.World({ x: 0, y: -18, z: 0 })
    return { scene, world, ...createDiceInstances(scene, world) }
  }

  it('주사위 5개를 인덱스 순서대로 만들고 메시·외곽선을 장면에 올린다', () => {
    const { entries, scene, world } = setup()

    expect(entries.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4])
    entries.forEach((entry) => {
      expect(scene.children).toContain(entry.mesh)
      expect(scene.children).toContain(entry.outline)
      expect(entry.enteredTray).toBe(false)
      expect(entry.visualOffset.angleTo(new THREE.Quaternion())).toBe(0)
    })
    world.free()
  })

  it('메시와 모든 자식이 dieIndex를 들고 있다 — 어느 면을 맞혀도 같은 주사위로 읽힌다', () => {
    const { entries, world } = setup()

    entries.forEach((entry) => {
      expect(entry.mesh.userData.dieIndex).toBe(entry.index)
      entry.mesh.children.forEach((child) => {
        expect(child.userData.dieIndex).toBe(entry.index)
      })
    })
    world.free()
  })

  it('지오메트리와 재질은 5개가 공유한다 — 주사위마다 다시 업로드하지 않는다', () => {
    const { entries, geometries, materials, world } = setup()

    const bodyGeometries = new Set<THREE.BufferGeometry>()
    const dieMaterials = new Set<THREE.Material>()
    entries.forEach((entry) => {
      const body = entry.mesh.children.find((child) => child instanceof THREE.Mesh)
      if (!(body instanceof THREE.Mesh)) throw new Error('주사위 본체 메시가 없습니다.')
      bodyGeometries.add(body.geometry)
      if (!Array.isArray(body.material)) dieMaterials.add(body.material)
    })

    expect(bodyGeometries).toEqual(new Set([geometries.body]))
    expect(dieMaterials).toEqual(new Set([materials.die]))
    expect(new Set(entries.map((entry) => entry.outline.material)).size).toBe(5)
    world.free()
  })

  it('바디는 config의 질량·마찰·감쇠를 그대로 쓰고 CCD로 얇은 바닥을 뚫지 않는다', () => {
    const { entries, world } = setup()
    const defaults = PHYSICS_DICE_CONFIG.defaults
    const entry = entries[0]
    if (!entry) throw new Error('주사위가 없습니다.')

    expect(entry.body.isDynamic()).toBe(true)
    expect(entry.body.isCcdEnabled()).toBe(true)
    expect(entry.body.linearDamping()).toBeCloseTo(defaults.linearDamping, 5)
    expect(entry.body.angularDamping()).toBeCloseTo(defaults.angularDamping, 5)
    expect(entry.collider.mass()).toBeCloseTo(defaults.mass, 5)
    expect(entry.collider.friction()).toBeCloseTo(defaults.friction, 5)
    expect(entry.collider.restitution()).toBeCloseTo(defaults.restitution, 5)
    world.free()
  })

  it('충돌체는 주사위 크기보다 살짝 작다 — 모서리가 서로 걸려 탑이 쌓이지 않게 한다', () => {
    const { entries, world } = setup()
    const halfSize =
      PHYSICS_DICE_CONFIG.defaults.diceSize * PHYSICS_DICE_CONFIG.scene.colliderHalfRatio

    expect(halfSize).toBeLessThan(PHYSICS_DICE_CONFIG.defaults.diceSize / 2)
    entries.forEach((entry) => {
      const extents = entry.collider.halfExtents()
      expect(extents.x).toBeCloseTo(halfSize, 5)
      expect(extents.y).toBeCloseTo(halfSize, 5)
      expect(extents.z).toBeCloseTo(halfSize, 5)
    })
    world.free()
  })

  it('외곽선은 바닥에 눕고 주사위보다 뒤에 그려지지 않는다', () => {
    const { entries, world } = setup()

    entries.forEach((entry) => {
      expect(entry.outline.rotation.x).toBeCloseTo(-Math.PI / 2, 6)
      expect(entry.outline.renderOrder).toBeGreaterThan(0)
      expect(entry.outline.material.transparent).toBe(true)
      expect(entry.outline.material.depthWrite).toBe(false)
    })
    world.free()
  })
})
