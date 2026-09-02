import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { ACCENT, INK, IVORY, matte } from './heroMaterials'

/**
 * 소품이 `userData`에 심는 움직임. 프레임 루프(`heroScene`)가 이것을 읽어 자전과
 * 위아래 흔들림을 준다 — 소품을 만드는 쪽이 값을 정하므로 타입도 여기 둔다.
 */
export interface SpinBob {
  bob?: number
  spin?: number
}

/**
 * 랜딩 히어로에 놓이는 게임별 소품. 장면 자체(카메라·조명·주사위 애니메이션)와 달리
 * 여기 있는 것들은 한 번 만들어 놓으면 그대로 서 있기만 한다.
 */

export function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function paddle(color: number) {
  const group = new THREE.Group()
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.13, 48), matte(color))
  blade.rotation.x = Math.PI / 2
  group.add(blade)
  const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.9, 8, 16), matte(0x202125))
  grip.position.y = -1.25
  group.add(grip)
  return group
}

/** 세워 둔 타일 넉 장 — 검정·흰색이 섞이고 가운데 한 장만 앞으로 넘어와 있다. */
export function buildDavinci() {
  const group = new THREE.Group()
  const tiles: [number, number, number, number][] = [
    [-2.1, -0.1, 0, INK],
    [-0.7, 0.05, 0, IVORY],
    [0.7, 0.05, 0, INK],
    [2.1, -0.1, 0, IVORY],
  ]
  tiles.forEach(([x, y, z, color], index) => {
    const tile = new THREE.Mesh(new RoundedBoxGeometry(1.05, 1.7, 0.34, 4, 0.12), matte(color))
    tile.castShadow = true
    tile.receiveShadow = true
    tile.position.set(x, y, z)
    tile.rotation.set(0, index % 2 === 0 ? 0.12 : -0.12, index % 2 === 0 ? 0.05 : -0.05)
    group.add(tile)
  })
  // 방금 맞혀 눕힌 한 장 — 판이 어디로 굴러가는지 보여 주는 레드 점이다.
  const opened = new THREE.Mesh(new RoundedBoxGeometry(1.05, 1.7, 0.34, 4, 0.12), matte(ACCENT))
  opened.position.set(0, -1.35, 1.1)
  opened.rotation.set(-1.15, 0, 0.08)
  opened.userData = { bob: 0.5 } satisfies SpinBob
  group.add(opened)
  return group
}

export function buildPingpong() {
  const group = new THREE.Group()
  const near = paddle(0xe53935)
  near.position.set(-1.5, 0.2, 0)
  near.rotation.set(0.2, 0.5, 0.25)
  group.add(near)
  const far = paddle(INK)
  far.position.set(1.6, -0.1, -0.6)
  far.rotation.set(-0.15, -0.6, -0.3)
  group.add(far)
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 32), matte(ACCENT))
  ball.position.set(0.1, 1.1, 0.7)
  ball.userData = { bob: 1 } satisfies SpinBob
  group.add(ball)
  return group
}

export function buildFishing() {
  const group = new THREE.Group()
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, 4.4, 20), matte(IVORY))
  rod.position.set(-0.6, 0.4, 0)
  rod.rotation.z = 0.55
  group.add(rod)
  const hook = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.08, 16, 48, Math.PI * 1.35),
    matte(ACCENT),
  )
  hook.position.set(1.35, -1.1, 0)
  hook.rotation.z = -0.4
  hook.userData = { bob: 0.6 } satisfies SpinBob
  group.add(hook)
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 8), matte(0x82838a))
  line.position.set(1.32, -0.2, 0)
  group.add(line)
  // 실물 낚시찌의 상하 투톤 — 위 레드·아래 아이보리. 반구 둘이 한 구를 이룬다.
  const bobber = new THREE.Group()
  const bobberTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    matte(ACCENT),
  )
  bobberTop.castShadow = true
  const bobberBottom = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    matte(IVORY),
  )
  bobber.add(bobberTop, bobberBottom)
  bobber.position.set(-1.9, -1.5, 0.6)
  bobber.rotation.z = -0.25
  bobber.userData = { bob: 1.3 } satisfies SpinBob
  group.add(bobber)
  return group
}
