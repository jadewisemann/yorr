import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { PHYSICS_DICE_CONFIG } from './config'
import type { PhysicsDiceValue } from './types'

const BASE_SIZE = PHYSICS_DICE_CONFIG.scene.baseDiceSize
const UP = new THREE.Vector3(0, 1, 0)
const PIP_FORWARD = new THREE.Vector3(0, 0, 1)

const FACE_NORMALS: ReadonlyArray<{ value: PhysicsDiceValue; normal: THREE.Vector3 }> = [
  { value: 1, normal: new THREE.Vector3(0, 1, 0) },
  { value: 6, normal: new THREE.Vector3(0, -1, 0) },
  { value: 2, normal: new THREE.Vector3(1, 0, 0) },
  { value: 5, normal: new THREE.Vector3(-1, 0, 0) },
  { value: 3, normal: new THREE.Vector3(0, 0, 1) },
  { value: 4, normal: new THREE.Vector3(0, 0, -1) },
]

const PIPS: Record<PhysicsDiceValue, ReadonlyArray<readonly [number, number]>> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
}

export interface PhysicsDiceGeometries {
  body: RoundedBoxGeometry
  outline: THREE.ShapeGeometry
  pip: THREE.CircleGeometry
  slotFill: THREE.ShapeGeometry
  slotFrame: THREE.ShapeGeometry
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
    slotFrame: roundedRectRingGeometry(
      slotOuter,
      slotInner,
      BASE_SIZE * (slot.cornerRadiusRatio + slot.borderOffsetRatio + slot.borderWidthRatio),
      BASE_SIZE * (slot.cornerRadiusRatio + slot.borderOffsetRatio),
    ),
    slotFill: roundedRectGeometry(
      slotOuter,
      BASE_SIZE * (slot.cornerRadiusRatio + slot.borderOffsetRatio + slot.borderWidthRatio),
    ),
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

export function quaternionForTopValue(value: PhysicsDiceValue) {
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

export function closestQuaternionForTopValue(
  value: PhysicsDiceValue,
  current: THREE.QuaternionLike,
) {
  const currentQuaternion = new THREE.Quaternion(current.x, current.y, current.z, current.w)
  const base = quaternionForTopValue(value)
  let closest = base
  let closestDot = -Infinity

  for (let turn = 0; turn < 4; turn += 1) {
    const yaw = new THREE.Quaternion().setFromAxisAngle(UP, (turn * Math.PI) / 2)
    const candidate = yaw.multiply(base.clone())
    const dot = currentQuaternion.dot(candidate)
    const distance = Math.abs(dot)
    if (distance <= closestDot) continue
    if (dot < 0) candidate.set(-candidate.x, -candidate.y, -candidate.z, -candidate.w)
    closest = candidate
    closestDot = distance
  }

  return closest
}

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

function collectFacePips(
  target: THREE.Matrix4[],
  value: PhysicsDiceValue,
  normal: THREE.Vector3,
  axisA: THREE.Vector3,
  axisB: THREE.Vector3,
) {
  for (const [column, row] of PIPS[value]) {
    const transform = new THREE.Object3D()
    transform.position.copy(normal).multiplyScalar(BASE_SIZE / 2 + 0.0065)
    transform.position.addScaledVector(axisA, column * BASE_SIZE * 0.232)
    transform.position.addScaledVector(axisB, row * BASE_SIZE * 0.232)
    transform.quaternion.setFromUnitVectors(PIP_FORWARD, normal)
    transform.updateMatrix()
    target.push(transform.matrix.clone())
  }
}

function roundedRectRingGeometry(
  outerHalf: number,
  innerHalf: number,
  outerRadius: number,
  innerRadius: number,
) {
  const shape = roundedRectPath(new THREE.Shape(), outerHalf, outerRadius)
  const hole = new THREE.Path()
  hole.moveTo(-innerHalf + innerRadius, -innerHalf)
  hole.quadraticCurveTo(-innerHalf, -innerHalf, -innerHalf, -innerHalf + innerRadius)
  hole.lineTo(-innerHalf, innerHalf - innerRadius)
  hole.quadraticCurveTo(-innerHalf, innerHalf, -innerHalf + innerRadius, innerHalf)
  hole.lineTo(innerHalf - innerRadius, innerHalf)
  hole.quadraticCurveTo(innerHalf, innerHalf, innerHalf, innerHalf - innerRadius)
  hole.lineTo(innerHalf, -innerHalf + innerRadius)
  hole.quadraticCurveTo(innerHalf, -innerHalf, innerHalf - innerRadius, -innerHalf)
  hole.lineTo(-innerHalf + innerRadius, -innerHalf)
  shape.holes.push(hole)
  return new THREE.ShapeGeometry(shape, 6)
}

function roundedRectGeometry(half: number, radius: number) {
  return new THREE.ShapeGeometry(roundedRectPath(new THREE.Shape(), half, radius), 6)
}

function roundedRectPath<T extends THREE.Path>(path: T, half: number, radius: number): T {
  path.moveTo(-half + radius, -half)
  path.lineTo(half - radius, -half)
  path.quadraticCurveTo(half, -half, half, -half + radius)
  path.lineTo(half, half - radius)
  path.quadraticCurveTo(half, half, half - radius, half)
  path.lineTo(-half + radius, half)
  path.quadraticCurveTo(-half, half, -half, half - radius)
  path.lineTo(-half, -half + radius)
  path.quadraticCurveTo(-half, -half, -half + radius, -half)
  return path
}
