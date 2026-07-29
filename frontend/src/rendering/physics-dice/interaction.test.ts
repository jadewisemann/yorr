import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { FakeWebGLRenderer } from '@/test/threeStubs'
import { createDiceInstances } from './diceInstances'
import { pickDie } from './interaction'

const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 600

/** 무대와 같은 위에서 내려다보는 직교 카메라. */
function topDownCamera() {
  const camera = new THREE.OrthographicCamera(-4.5, 4.5, 3, -3, 0.1, 30)
  camera.position.set(0, 10, 0.001)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  return camera
}

function renderer() {
  const fake = new FakeWebGLRenderer()
  fake.setSize(CANVAS_WIDTH, CANVAS_HEIGHT)
  return fake as unknown as THREE.WebGLRenderer
}

/** 월드 좌표를 그 지점을 가리키는 포인터 이벤트로 바꾼다 — 화면 좌표계 왕복을 그대로 검증한다. */
function pointerAt(position: THREE.Vector3, camera: THREE.Camera) {
  const ndc = position.clone().project(camera)
  return {
    clientX: ((ndc.x + 1) / 2) * CANVAS_WIDTH,
    clientY: ((1 - ndc.y) / 2) * CANVAS_HEIGHT,
  } as unknown as PointerEvent
}

describe('pickDie', () => {
  beforeAll(async () => {
    await RAPIER.init()
  })

  function scene() {
    const world = new RAPIER.World({ x: 0, y: -18, z: 0 })
    const { entries } = createDiceInstances(new THREE.Scene(), world)
    // 결과 줄처럼 x축으로 늘어놓는다.
    entries.forEach((entry) => {
      entry.mesh.position.set((entry.index - 2) * 1.4, 0.5, 0)
      entry.mesh.updateMatrixWorld(true)
    })
    return { entries, world }
  }

  it('포인터가 가리키는 주사위의 인덱스를 돌려준다', () => {
    const camera = topDownCamera()
    const { entries, world } = scene()

    entries.forEach((entry) => {
      expect(pickDie(pointerAt(entry.mesh.position, camera), renderer(), camera, entries)).toBe(
        entry.index,
      )
    })
    world.free()
  })

  it('주사위 사이 빈 공간을 누르면 null — 빈 곳 탭이 킵 토글로 새지 않는다', () => {
    const camera = topDownCamera()
    const { entries, world } = scene()

    const gap = new THREE.Vector3(0, 0.5, 2.2)

    expect(pickDie(pointerAt(gap, camera), renderer(), camera, entries)).toBeNull()
    world.free()
  })

  it('눈(pip) 같은 자식 메시를 맞혀도 부모 주사위 인덱스로 되돌린다', () => {
    const camera = topDownCamera()
    const { entries, world } = scene()
    const target = entries[3]
    if (!target) throw new Error('주사위 4번이 없습니다.')
    // 눈만 남기면 히트 대상이 자식 InstancedMesh뿐이다.
    const pips = target.mesh.children.filter((child) => child instanceof THREE.InstancedMesh)
    target.mesh.clear()
    for (const child of pips) target.mesh.add(child)
    target.mesh.updateMatrixWorld(true)

    expect(pips.length).toBeGreaterThan(0)
    expect(pickDie(pointerAt(target.mesh.position, camera), renderer(), camera, entries)).toBe(3)
    world.free()
  })

  it('캔버스 안 상대 좌표로 판정한다 — 캔버스 밖 좌표는 아무 주사위도 맞히지 않는다', () => {
    const camera = topDownCamera()
    const { entries, world } = scene()

    const outside = { clientX: CANVAS_WIDTH * 2, clientY: CANVAS_HEIGHT * 2 }

    expect(pickDie(outside as unknown as PointerEvent, renderer(), camera, entries)).toBeNull()
    world.free()
  })
})
