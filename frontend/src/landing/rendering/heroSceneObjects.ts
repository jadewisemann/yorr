import * as THREE from 'three'
import { HERO_PALETTE, matte, type SpinBob } from './heroTextures'

/**
 * 히어로 장면의 **야추·라이어스·결투 오브젝트 조립**.
 *
 * `heroScene.ts`에서 갈라 둔 이유: 이 세 게임의 소품은 좌표·회전·크기 표일 뿐이고
 * 장면 수명(루프·리사이즈·정리)과 무관하다. 소품 배치를 손볼 때 루프 코드를
 * 지나치지 않게 하고, 나머지 게임(탁구·낚시·다빈치)의 `heroObjects.ts`와 짝을 이룬다.
 */

const SLATE = 0x24252a

/** 주사위 메시를 만드는 함수 — 장면이 기하·재질 캐시를 소유하므로 주입받는다. */
export type DieMeshFactory = (size: number, tone?: 'ivory' | 'accent') => THREE.Mesh

/** 야추 — 다섯 주사위, 가운데만 레드(킵 = 레드 문법). */
export const buildYacht = (die: DieMeshFactory): THREE.Group => {
  const group = new THREE.Group()
  const spots: [number, number, number][] = [
    [-2.1, 0.3, 0.4],
    [-0.7, -0.5, -0.6],
    [0.6, 0.55, 0.2],
    [1.9, -0.35, -0.3],
    [0.1, -1.35, 0.8],
  ]
  spots.forEach(([x, y, z], index) => {
    const mesh = die(index === 2 ? 1.5 : 1.2, index === 2 ? 'accent' : 'ivory')
    mesh.position.set(x, y, z)
    mesh.userData = { spin: 0.12 + index * 0.05 } satisfies SpinBob
    group.add(mesh)
  })
  return group
}

/** 라이어스 — 컵 하나와 주사위 셋. */
export const buildLiars = (die: DieMeshFactory): THREE.Group => {
  const group = new THREE.Group()
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 0.85, 2.1, 48, 1, true),
    matte(SLATE, { side: THREE.DoubleSide }),
  )
  cup.position.set(1.5, 0.1, 0)
  cup.rotation.z = -0.28
  group.add(cup)
  const dice: [number, number, number, number][] = [
    [-1.6, -0.5, 0.3, 1.2],
    [-0.4, 0.4, -0.4, 1.05],
    [-1.1, 0.9, 0.6, 0.85],
  ]
  dice.forEach(([x, y, z, size], index) => {
    const mesh = die(size)
    mesh.position.set(x, y, z)
    mesh.userData = { spin: 0.1 + index * 0.06 } satisfies SpinBob
    group.add(mesh)
  })
  return group
}

/** 결투 — 여섯 약실 리볼버 실린더와 탄약 한 발. */
export const buildDuel = (): THREE.Group => {
  const group = new THREE.Group()
  const drum = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.72, 48), matte(SLATE))
  body.castShadow = true
  body.receiveShadow = true
  drum.add(body)
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2
    const chamber = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.26, 0.78, 24),
      matte(0x0d0e10),
    )
    chamber.position.set(Math.cos(angle) * 0.72, 0, Math.sin(angle) * 0.72)
    drum.add(chamber)
    if (index < 2) {
      const round = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.22, 0.84, 20),
        matte(HERO_PALETTE.accent),
      )
      round.position.copy(chamber.position)
      drum.add(round)
    }
  }
  drum.rotation.set(Math.PI / 2.35, 0, 0.2)
  drum.position.set(0.5, 0.15, 0)
  drum.userData = { spin: 0.42 } satisfies SpinBob
  group.add(drum)

  const cartridge = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.2, 0.5, 8, 20),
    matte(HERO_PALETTE.accent),
  )
  cartridge.position.set(-1.9, -0.5, 0.6)
  cartridge.rotation.z = 1.1
  cartridge.castShadow = true
  cartridge.userData = { bob: 0.9 } satisfies SpinBob
  group.add(cartridge)
  return group
}
