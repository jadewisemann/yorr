import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { createDiceInstances } from '@/yacht/rendering/physics-dice/diceInstances'

/**
 * 주사위 다섯 개만 올라간 빈 세계. 배치와 인스턴스 생성을 재는 검사들이 함께 쓴다.
 *
 * `RAPIER.init()`은 부르는 쪽의 `beforeAll`에 맡긴다 — 검사 파일마다 초기화
 * 시점이 다를 수 있기 때문이다.
 */
export function diceWorld() {
  const scene = new THREE.Scene()
  const world = new RAPIER.World({ x: 0, y: -18, z: 0 })
  return { scene, world, ...createDiceInstances(scene, world) }
}
