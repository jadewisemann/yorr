import * as THREE from 'three'
import { TABLE_H, xToWorld } from '@/pingpong/domain/court'
import type { MatBag } from './materials'
import { clamp, easeOut, lerp } from './sceneMath'

const PADDLE_Y = TABLE_H + 0.15 // 라켓을 쥔 높이

export interface Paddle {
  group: THREE.Group
  facing: -1 | 1
  baseZ: number
}

export function makePaddle(color: number, facing: -1 | 1, baseZ: number, mats: MatBag): Paddle {
  const group = new THREE.Group()

  const blade = new THREE.Mesh(
    mats.geo(new THREE.CylinderGeometry(0.077, 0.077, 0.009, 28)),
    mats.rubber(color),
  )
  blade.rotation.x = Math.PI / 2
  group.add(blade)

  const rim = new THREE.Mesh(mats.geo(new THREE.TorusGeometry(0.077, 0.006, 8, 28)), mats.wood)
  group.add(rim)

  const handle = new THREE.Mesh(mats.geo(new THREE.BoxGeometry(0.028, 0.1, 0.019)), mats.wood)
  handle.position.set(0, -0.12, 0)
  group.add(handle)

  group.position.set(0, PADDLE_Y, baseZ)
  return { group, facing, baseZ }
}

export function poseP(p: Paddle, xNorm: number, swing: number) {
  const g = p.group
  const f = p.facing
  const t = easeOut(1 - clamp(swing, 0, 1))
  const READY = 0.38 // 준비자세 (몸쪽으로 살짝 열어둠)
  const THRU = -0.55 // 휘둘러 지나간 각
  g.position.x = xToWorld(xNorm)
  g.position.z = p.baseZ + f * -0.13 * Math.sin(Math.PI * t) * (swing > 0 ? 1 : 0)
  g.position.y = PADDLE_Y + 0.03 * Math.sin(Math.PI * t) * (swing > 0 ? 1 : 0)
  g.rotation.y = f * lerp(THRU, READY, t)
  g.rotation.z = f * lerp(-0.5, -0.15, t)
}
