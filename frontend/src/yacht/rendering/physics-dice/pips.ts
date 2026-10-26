import * as THREE from 'three'
import { PHYSICS_DICE_CONFIG } from './config'
import type { PhysicsDiceValue } from './types'

/**
 * 주사위 면의 **눈금 배치** — 면별 좌표와 인스턴스 변환 행렬.
 *
 * 모델(`model.ts`)에서 갈라 둔 이유: 눈금 배치는 "각 면의 어느 자리에 점이 있는가"라는
 * 데이터와 그 변환뿐이다. 재질·지오메트리 생성과 섞이면 값을 조정할 때 모델 전체를
 * 읽어야 한다.
 */

const BASE_SIZE = PHYSICS_DICE_CONFIG.scene.baseDiceSize
const PIP_FORWARD = new THREE.Vector3(0, 0, 1)

/** 면 값 → 눈금의 (열, 행) 좌표. -1·0·1은 면 안에서의 정규화 위치다. */
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

/** 한 면의 눈금들을 `target`에 밀어 넣는다. 법선과 두 축이 면의 방향을 정한다. */
export function collectFacePips(
  target: THREE.Matrix4[],
  value: PhysicsDiceValue,
  normal: THREE.Vector3,
  axisA: THREE.Vector3,
  axisB: THREE.Vector3,
): void {
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
