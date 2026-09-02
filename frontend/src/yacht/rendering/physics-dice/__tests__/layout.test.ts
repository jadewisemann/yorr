import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { createKeepSlots } from '@/yacht/rendering/physics-dice/arena'
import { PHYSICS_DICE_CONFIG } from '@/yacht/rendering/physics-dice/config'
import {
  keepSlotPosition,
  keepSlotScale,
  keepSlotSpacing,
  lineUpDice,
  positionKeepSlots,
  prepareAlignmentEntries,
  prepareLayoutEntries,
  resultCameraWidth,
  resultCenterY,
  resultDieScale,
  resultSpacing,
  simulationDieScale,
  tiltedBowlPosition,
  updateAlignmentEntries,
  updateLayoutEntries,
} from '@/yacht/rendering/physics-dice/layout'
import { topFaceFromQuaternion } from '@/yacht/rendering/physics-dice/model'
import type {
  PhysicsDiceIndex,
  PhysicsDiceSet,
  PhysicsHeldDice,
} from '@/yacht/rendering/physics-dice/types'
import { diceWorld } from './diceWorld'

const SCENE = PHYSICS_DICE_CONFIG.scene
const DICE: PhysicsDiceSet = [3, 6, 1, 5, 4]
const NONE_HELD: PhysicsHeldDice = [false, false, false, false, false]

beforeAll(async () => {
  await RAPIER.init()
})

function setup() {
  const { entries, geometries, scene, world } = diceWorld()
  const { keepSlotMaterials, keepSlots } = createKeepSlots(scene, geometries)
  return { entries, keepSlotMaterials, keepSlots, scene, world }
}

describe('킵 슬롯 배치', () => {
  it('슬롯 5개가 킵 레일 위에 같은 간격으로 놓이고 가운데 슬롯이 중앙이다', () => {
    const positions = [0, 1, 2, 3, 4].map(keepSlotPosition)
    const gaps = positions
      .slice(1)
      .map((position, index) => position.x - (positions[index]?.x ?? 0))

    expect(positions[2]?.x).toBeCloseTo(0, 6)
    gaps.forEach((gap) => {
      expect(gap).toBeCloseTo(keepSlotSpacing(), 6)
    })
    positions.forEach((position) => {
      expect(position.z).toBeCloseTo(SCENE.tray.slotZ, 6)
      expect(position.y).toBeGreaterThan(0)
    })
    expect(SCENE.tray.slotZ).toBeGreaterThan(SCENE.tray.separatorZ)
  })

  it('슬롯 간격이 주사위 폭보다 넓다 — 5개를 다 킵해도 겹치지 않는다', () => {
    const dieWidth = PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.keepSlots.diceScale

    expect(keepSlotSpacing()).toBeGreaterThan(dieWidth)
  })

  it('킵해도 주사위 크기가 그대로다 — 결과 줄과 킵 레일의 배율이 같다', () => {
    expect(keepSlotScale()).toBeCloseTo(resultDieScale(), 6)
    expect(simulationDieScale()).toBeLessThan(resultDieScale())
  })

  it('점유된 슬롯 바만 악센트 재질로 바꾼다 — 킵 개수가 색으로 읽힌다', () => {
    const { keepSlotMaterials, keepSlots, world } = setup()
    const [occupied, empty] = keepSlotMaterials

    positionKeepSlots(keepSlots, 2, keepSlotMaterials)

    keepSlots.forEach((slot, index) => {
      const bar = slot.children[0]
      if (!(bar instanceof THREE.Mesh)) throw new Error('슬롯 바가 없습니다.')
      expect(bar.material).toBe(index < 2 ? occupied : empty)
      expect(slot.position.x).toBeCloseTo(keepSlotPosition(index).x, 6)
      expect(slot.position.z).toBeCloseTo(keepSlotPosition(index).z, 6)
    })
    world.free()
  })
})

describe('resultCameraWidth', () => {
  it('결과 줄 5개가 항상 화면 안에 들어오는 폭을 보장한다', () => {
    const outerCenter = 2 * resultSpacing()
    const dieHalf = (PHYSICS_DICE_CONFIG.defaults.diceSize * SCENE.resultDiceScale) / 2

    expect(resultCameraWidth()).toBeGreaterThanOrEqual(SCENE.camera.resultHalfWidth)
    expect(resultCameraWidth()).toBeGreaterThan(outerCenter + dieHalf)
  })
})

describe('tiltedBowlPosition', () => {
  it('기울이는 동안 사발이 흔들던 자리에서 쏟는 자리로 미끄러지며 들린다', () => {
    const start = tiltedBowlPosition(0, 0)
    const end = tiltedBowlPosition(1, THREE.MathUtils.degToRad(SCENE.bowl.tiltDegrees))

    expect(start.x).toBeCloseTo(SCENE.bowl.startX, 6)
    expect(start.y).toBeCloseTo(SCENE.bowl.hoverY, 6)
    expect(start.z).toBeCloseTo(SCENE.bowl.startZ, 6)
    expect(end.x).toBeGreaterThan(start.x)
    expect(end.y).toBeGreaterThan(start.y)
  })

  it('진행도에 따라 x가 단조 증가한다 — 되돌아가는 흔들림이 없다', () => {
    const angle = THREE.MathUtils.degToRad(SCENE.bowl.tiltDegrees)
    const xs = [0, 0.25, 0.5, 0.75, 1].map((progress) => tiltedBowlPosition(progress, angle).x)

    xs.slice(1).forEach((x, index) => {
      expect(x).toBeGreaterThan(xs[index] ?? Number.POSITIVE_INFINITY)
    })
  })
})

/** 3번·1번을 그 순서로 킵해 둔 상태. 줄 세우기 검사 둘이 여기서 갈린다. */
const KEPT_THREE_AND_ONE: { held: PhysicsHeldDice; heldOrder: PhysicsDiceIndex[] } = {
  held: [false, true, false, true, false],
  heldOrder: [3, 1],
}

describe('lineUpDice', () => {
  it('킵한 주사위는 킵 순서대로 슬롯에, 남은 주사위는 가운데 정렬된 결과 줄에 놓는다', () => {
    const { entries, world } = setup()
    const { held, heldOrder } = KEPT_THREE_AND_ONE

    lineUpDice(entries, held, heldOrder, DICE)

    expect(entries[3]?.mesh.position.x).toBeCloseTo(keepSlotPosition(0).x, 6)
    expect(entries[1]?.mesh.position.x).toBeCloseTo(keepSlotPosition(1).x, 6)
    const rolling = [entries[0], entries[2], entries[4]]
    rolling.forEach((entry, row) => {
      expect(entry?.mesh.position.x).toBeCloseTo((row - 1) * resultSpacing(), 6)
      expect(entry?.mesh.position.y).toBeCloseTo(resultCenterY(), 6)
      expect(entry?.mesh.position.z).toBeCloseTo(SCENE.tray.resultRowZ, 6)
    })
    world.free()
  })

  it('모든 주사위가 확정값을 위로 보이고 물리 바디가 메시와 같은 자세로 고정된다', () => {
    const { entries, world } = setup()
    const held: PhysicsHeldDice = [true, false, false, false, true]

    lineUpDice(entries, held, [0, 4], DICE)

    entries.forEach((entry) => {
      expect(topFaceFromQuaternion(entry.mesh.quaternion)).toBe(DICE[entry.index])
      expect(entry.body.isFixed()).toBe(true)
      const translation = entry.body.translation()
      expect(translation.x).toBeCloseTo(entry.mesh.position.x, 5)
      expect(translation.z).toBeCloseTo(entry.mesh.position.z, 5)
      expect(topFaceFromQuaternion(entry.body.rotation())).toBe(DICE[entry.index])
    })
    world.free()
  })

  it('킵 여부를 외곽선 진하기로 구분한다', () => {
    const { entries, world } = setup()
    const held: PhysicsHeldDice = [true, false, false, false, false]

    lineUpDice(entries, held, [0], DICE)

    expect(entries[0]?.outline.material.opacity).toBeGreaterThan(0.5)
    expect(entries[1]?.outline.material.opacity).toBeLessThan(0.2)
    entries.forEach((entry) => {
      expect(entry.outline.visible).toBe(true)
      expect(entry.outline.position.x).toBeCloseTo(entry.mesh.position.x, 6)
    })
    world.free()
  })

  it('킵 순서에 없는 주사위도 슬롯 0으로 떨어져 화면 밖으로 사라지지 않는다', () => {
    const { entries, world } = setup()
    const held: PhysicsHeldDice = [false, false, true, false, false]

    lineUpDice(entries, held, [], DICE)

    expect(entries[2]?.mesh.position.x).toBeCloseTo(keepSlotPosition(0).x, 6)
    world.free()
  })

  it('keepAll이면 다섯 개가 전부 레일에 오르고, 이미 킵한 주사위는 자기 슬롯을 지킨다', () => {
    const { entries, world } = setup()
    const { held, heldOrder } = KEPT_THREE_AND_ONE

    lineUpDice(entries, held, heldOrder, DICE, true)

    const expectedSlotOf = [2, 1, 3, 0, 4]
    entries.forEach((entry) => {
      const slot = expectedSlotOf[entry.index] ?? -1
      expect(entry.mesh.position.x).toBeCloseTo(keepSlotPosition(slot).x, 6)
      expect(entry.mesh.position.z).toBeCloseTo(SCENE.tray.slotZ, 6)
      expect(entry.mesh.position.z).not.toBeCloseTo(SCENE.tray.resultRowZ, 6)
      expect(entry.outline.material.opacity).toBeGreaterThan(0.5)
    })
    world.free()
  })
})

describe('킵 전환 애니메이션', () => {
  it('물리는 즉시 목표로 고정하고 화면만 이전 자세에서 목표로 보간한다', () => {
    const { entries, world } = setup()
    lineUpDice(entries, NONE_HELD, [], DICE)
    const before = entries.map((entry) => entry.mesh.position.clone())
    const held: PhysicsHeldDice = [false, false, true, false, false]

    const layout = prepareLayoutEntries(entries, held, [2], DICE)

    expect(entries[2]?.body.translation().x).toBeCloseTo(keepSlotPosition(0).x, 5)
    updateLayoutEntries(layout, 0)
    entries.forEach((entry, index) => {
      expect(entry.mesh.position.distanceTo(before[index] ?? new THREE.Vector3())).toBeLessThan(
        1e-6,
      )
    })

    updateLayoutEntries(layout, 1)
    expect(entries[2]?.mesh.position.x).toBeCloseTo(keepSlotPosition(0).x, 6)
    expect(entries[2]?.mesh.scale.x).toBeCloseTo(keepSlotScale(), 6)
    expect(entries[2]?.outline.material.opacity).toBeCloseTo(0.92, 6)
    expect(entries[0]?.outline.material.opacity).toBeCloseTo(0.12, 6)
    world.free()
  })

  it('전환 중에도 목표를 넘어서지 않는다 — 튀어 오르는 오버슈트가 없다', () => {
    const { entries, world } = setup()
    lineUpDice(entries, NONE_HELD, [], DICE)
    const held: PhysicsHeldDice = [false, false, true, false, false]
    const layout = prepareLayoutEntries(entries, held, [2], DICE)
    const from = entries[2]?.mesh.position.clone() ?? new THREE.Vector3()
    const target = keepSlotPosition(0)
    const span = target.distanceTo(from)

    for (const progress of [0.2, 0.4, 0.6, 0.8]) {
      updateLayoutEntries(layout, progress)
      const travelled = (entries[2]?.mesh.position ?? new THREE.Vector3()).distanceTo(from)
      expect(travelled).toBeLessThanOrEqual(span + 1e-6)
    }
    world.free()
  })
})

describe('결과 정렬 애니메이션', () => {
  it('lineUpEnd 시점에는 결과 줄에 정확히 도착하고 확정값이 위를 향한다', () => {
    const { entries, world } = setup()
    const held: PhysicsHeldDice = [false, false, false, false, true]
    entries.forEach((entry) => {
      entry.mesh.position.set(entry.index * 0.4 - 1, 1.4, -1.8)
    })

    const alignment = prepareAlignmentEntries(entries, held, [4], DICE)
    updateAlignmentEntries(alignment, SCENE.alignment.lineUpEnd)

    const rolling = [entries[0], entries[1], entries[2], entries[3]]
    rolling.forEach((entry, row) => {
      expect(entry?.mesh.position.x).toBeCloseTo((row - 1.5) * resultSpacing(), 6)
      expect(entry?.mesh.position.y).toBeCloseTo(resultCenterY(), 6)
    })
    expect(entries[4]?.mesh.position.x).toBeCloseTo(keepSlotPosition(0).x, 6)
    entries.forEach((entry) => {
      expect(topFaceFromQuaternion(entry.mesh.quaternion)).toBe(DICE[entry.index])
    })
    world.free()
  })

  it('굴린 주사위만 정렬 중 한 번 떠오르고 킵된 주사위는 레일에 붙어 있다', () => {
    const { entries, world } = setup()
    const held: PhysicsHeldDice = [false, false, false, false, true]
    entries.forEach((entry) => {
      entry.mesh.position.set(0, 0.5, -1.8)
    })
    entries[4]?.mesh.position.setY(keepSlotPosition(0).y)

    const alignment = prepareAlignmentEntries(entries, held, [4], DICE)
    updateAlignmentEntries(alignment, SCENE.alignment.lineUpEnd / 2)

    expect(entries[0]?.mesh.position.y).toBeGreaterThan(resultCenterY() + 0.2)
    expect(entries[4]?.mesh.position.y).toBeCloseTo(keepSlotPosition(0).y, 6)
    world.free()
  })

  it('굴린 주사위 외곽선은 정렬 후반에야 나타난다 — 공중에서 밑줄이 따라다니지 않게', () => {
    const { entries, world } = setup()
    const held: PhysicsHeldDice = [false, false, false, false, true]

    const alignment = prepareAlignmentEntries(entries, held, [4], DICE)
    updateAlignmentEntries(alignment, SCENE.alignment.lineUpEnd * 0.1)

    expect(entries[0]?.outline.visible).toBe(false)
    expect(entries[0]?.outline.material.opacity).toBe(0)
    expect(entries[4]?.outline.visible).toBe(true)
    expect(entries[4]?.outline.material.opacity).toBeCloseTo(0.92, 6)

    updateAlignmentEntries(alignment, SCENE.alignment.lineUpEnd)
    expect(entries[0]?.outline.visible).toBe(true)
    expect(entries[0]?.outline.material.opacity).toBeCloseTo(0.12, 6)
    world.free()
  })

  it('진행도 1을 넘겨도 lineUpEnd 상태에서 더 움직이지 않는다', () => {
    const { entries, world } = setup()
    const alignment = prepareAlignmentEntries(entries, NONE_HELD, [], DICE)

    updateAlignmentEntries(alignment, 1)
    const settled = entries.map((entry) => entry.mesh.position.clone())
    updateAlignmentEntries(alignment, 5)

    entries.forEach((entry, index) => {
      expect(entry.mesh.position.distanceTo(settled[index] ?? new THREE.Vector3())).toBeLessThan(
        1e-6,
      )
    })
    world.free()
  })
})
