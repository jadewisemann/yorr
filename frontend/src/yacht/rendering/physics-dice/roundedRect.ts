import * as THREE from 'three'

/**
 * 주사위 형상이 쓰는 **둥근 사각형 기하** — 선택 테두리의 링과 그 경로.
 *
 * 모델(`model.ts`)에서 갈라 둔 이유: 이 두 함수는 주사위 재질·눈금과 무관한 순수
 * 2D 도형 조작이다. 반지름 계수만 바꿔 테두리 모양을 조정할 때 모델 코드를 지나치지
 * 않게 한다.
 */

/** 둥근 사각형 경로를 `path`에 그린다 — Shape와 Path 둘 다 받는다. */
export function roundedRectPath<T extends THREE.Path>(path: T, half: number, radius: number): T {
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

/** 바깥 둥근 사각형에서 안쪽 둥근 사각형을 뺀 **링** 지오메트리(테두리용). */
export function roundedRectRingGeometry(
  outerHalf: number,
  innerHalf: number,
  outerRadius: number,
  innerRadius: number,
): THREE.ShapeGeometry {
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
