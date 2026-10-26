import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { PHYSICS_DICE_CONFIG } from './config'
import { collectFacePips } from './pips'
import { roundedRectRingGeometry } from './roundedRect'
import type { PhysicsDiceValue } from './types'

/**
 * 물리 주사위의 **메시 조립** — 지오메트리·재질·한 개의 주사위 그룹, 그리고 자세
 * (어느 면이 위인가) 계산.
 *
 * 순수 도형 조작은 두 파일로 갈랐다:
 * - `roundedRect.ts` — 선택 테두리용 링과 둥근 사각형 경로
 * - `pips.ts` — 면별 눈금 좌표와 인스턴스 변환
 *
 * 이 파일은 그것들을 엮어 Three.js 객체를 만들고, 쿼터니언↔면 값 변환을 맡는다.
 */

const BASE_SIZE = PHYSICS_DICE_CONFIG.scene.baseDiceSize
const UP = new THREE.Vector3(0, 1, 0)

const FACE_NORMALS: ReadonlyArray<{ value: PhysicsDiceValue; normal: THREE.Vector3 }> = [
  { value: 1, normal: new THREE.Vector3(0, 1, 0) },
  { value: 6, normal: new THREE.Vector3(0, -1, 0) },
  { value: 2, normal: new THREE.Vector3(1, 0, 0) },
  { value: 5, normal: new THREE.Vector3(-1, 0, 0) },
  { value: 3, normal: new THREE.Vector3(0, 0, 1) },
  { value: 4, normal: new THREE.Vector3(0, 0, -1) },
]

export interface PhysicsDiceGeometries {
  body: RoundedBoxGeometry
  outline: THREE.ShapeGeometry
  pip: THREE.CircleGeometry
  slotBar: THREE.PlaneGeometry
}

export interface PhysicsDiceMaterials {
  dark: THREE.MeshStandardMaterial
  die: THREE.MeshStandardMaterial
  red: THREE.MeshStandardMaterial
}

export function createPhysicsDiceGeometries(): PhysicsDiceGeometries {
  const selection = PHYSICS_DICE_CONFIG.scene.selectionBorder
  const slot = PHYSICS_DICE_CONFIG.scene.keepSlots
  const selectionInner = BASE_SIZE / 2 + BASE_SIZE * selection.offsetRatio
  const selectionOuter = selectionInner + BASE_SIZE * selection.widthRatio
  const slotInner = BASE_SIZE / 2 + BASE_SIZE * slot.borderOffsetRatio
  const slotOuter = slotInner + BASE_SIZE * slot.borderWidthRatio

  return {
    body: new RoundedBoxGeometry(BASE_SIZE, BASE_SIZE, BASE_SIZE, 4, BASE_SIZE * 0.151),
    pip: new THREE.CircleGeometry(BASE_SIZE * 0.0684, 12),
    outline: roundedRectRingGeometry(
      selectionOuter,
      selectionInner,
      BASE_SIZE * (selection.cornerRadiusRatio + selection.offsetRatio + selection.widthRatio),
      BASE_SIZE * (selection.cornerRadiusRatio + selection.offsetRatio),
    ),
    slotBar: new THREE.PlaneGeometry(slotOuter * 2, slot.barDepth),
  }
}

export function createPhysicsDiceMaterials(): PhysicsDiceMaterials {
  return {
    die: new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.02 }),
    dark: new THREE.MeshStandardMaterial({
      roughness: 0.62,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    red: new THREE.MeshStandardMaterial({
      roughness: 0.56,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  }
}

/** 한 개의 주사위 그룹 — 몸통 + 면별 눈금 인스턴스. */
export function createDieModel(
  index: number,
  materials: PhysicsDiceMaterials,
  geometries: PhysicsDiceGeometries,
) {
  const group = new THREE.Group()
  group.userData.dieIndex = index
  const body = new THREE.Mesh(geometries.body, materials.die)
  body.castShadow = true
  body.receiveShadow = true
  body.userData.dieIndex = index
  group.add(body)

  const matrices: Record<'dark' | 'red', THREE.Matrix4[]> = { dark: [], red: [] }
  // 1면만 빨강 — 나머지는 검정. 면 법선과 두 축은 `pips.ts`가 좌표로 쓴다.
  collectFacePips(
    matrices.red,
    1,
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 1),
  )
  collectFacePips(
    matrices.dark,
    6,
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, -1),
  )
  collectFacePips(
    matrices.dark,
    2,
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 1, 0),
  )
  collectFacePips(
    matrices.dark,
    5,
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0),
  )
  collectFacePips(
    matrices.dark,
    3,
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  )
  collectFacePips(
    matrices.dark,
    4,
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  )

  for (const kind of ['dark', 'red'] as const) {
    const pips = new THREE.InstancedMesh(geometries.pip, materials[kind], matrices[kind].length)
    matrices[kind].forEach((matrix, matrixIndex) => {
      pips.setMatrixAt(matrixIndex, matrix)
    })
    pips.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    pips.userData.dieIndex = index
    group.add(pips)
  }
  return group
}

/** 면 값이 위로 오도록 하는 회전. */
export function quaternionForTopValue(value: PhysicsDiceValue): THREE.Quaternion {
  const rotations: Record<PhysicsDiceValue, readonly [number, number, number]> = {
    1: [0, 0, 0],
    2: [0, 0, Math.PI / 2],
    3: [-Math.PI / 2, 0, 0],
    4: [Math.PI / 2, 0, 0],
    5: [0, 0, -Math.PI / 2],
    6: [Math.PI, 0, 0],
  }
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotations[value]))
}

export function faceNormalForValue(value: PhysicsDiceValue): THREE.Vector3 {
  const face = FACE_NORMALS.find((entry) => entry.value === value)
  if (!face) throw new RangeError(`No face normal for dice value ${value}`)
  return face.normal.clone()
}

/** 이 회전에서 위(+Y)를 향한 면. 정렬이 가장 큰 법선이 이긴다. */
export function topFaceFromQuaternion(rotation: THREE.QuaternionLike): PhysicsDiceValue {
  const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
  return FACE_NORMALS.reduce(
    (best, face) => {
      const alignment = face.normal.clone().applyQuaternion(quaternion).dot(UP)
      return alignment > best.alignment ? { value: face.value, alignment } : best
    },
    { value: 1 as PhysicsDiceValue, alignment: -Infinity },
  ).value
}
