import * as THREE from 'three'
import { BALL_R, FAR_Z, IDEAL1, IDEAL2, NEAR_Z, posToZ } from '@/pingpong/domain/court'
import type { ResourceKeeper } from './arena'
import { MASCOT_BACK, MASCOT_SCALE, type Mascot, makeMascot } from './mascot'
import type { MatBag } from './materials'
import { makePaddle, type Paddle } from './paddle'

const TRAIL = 5 // 스매시 잔상 개수

/** 프레임마다 움직이는 것들. 무대(`arena.ts`)와 달리 매 틱 갱신 대상이다. */
export interface SceneActors {
  readonly p1Paddle: Paddle
  readonly p2Paddle: Paddle
  readonly p1Mascot: Mascot
  readonly p2Mascot: Mascot
  readonly ball: THREE.Mesh
  readonly ballShadow: THREE.Mesh
  readonly p1Shadow: THREE.Mesh
  readonly p2Shadow: THREE.Mesh
  readonly trail: THREE.Mesh[]
  readonly history: THREE.Vector3[]
  readonly ring: THREE.Mesh
  readonly ringMat: THREE.MeshBasicMaterial
}

export function buildActors(
  scene: THREE.Scene,
  mats: MatBag,
  keep: ResourceKeeper,
  texBlob: THREE.Texture,
): SceneActors {
  const P1_COLOR = 0x2b8fe0 // 가까운쪽(P1) 파랑 — 기존 2D 색 유지
  const P2_COLOR = 0xe2513c // 먼쪽(P2) 빨강
  const p1Paddle = makePaddle(P1_COLOR, -1, posToZ(IDEAL1), mats)
  const p2Paddle = makePaddle(P2_COLOR, 1, posToZ(IDEAL2), mats)
  scene.add(p1Paddle.group, p2Paddle.group)
  const p1Mascot = makeMascot(P1_COLOR, NEAR_Z + MASCOT_BACK, -1, mats)
  const p2Mascot = makeMascot(P2_COLOR, FAR_Z - MASCOT_BACK, 1, mats)
  scene.add(p1Mascot.root, p2Mascot.root)

  const blobGeo = keep.geo(new THREE.PlaneGeometry(1, 1))
  const mkBlob = (opacity: number) => {
    const m = new THREE.Mesh(
      blobGeo,
      keep.mat(
        new THREE.MeshBasicMaterial({
          map: texBlob,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      ),
    )
    m.rotation.x = -Math.PI / 2
    scene.add(m)
    return m
  }
  const ballShadow = mkBlob(0.85)
  const p1Shadow = mkBlob(0.5)
  const p2Shadow = mkBlob(0.5)
  const mascotBlob = 0.9 * MASCOT_SCALE
  p1Shadow.scale.set(mascotBlob, mascotBlob, 1)
  p1Shadow.position.set(0, 0.004, NEAR_Z + MASCOT_BACK)
  p2Shadow.scale.set(mascotBlob, mascotBlob, 1)
  p2Shadow.position.set(0, 0.004, FAR_Z - MASCOT_BACK)

  const ballGeo = keep.geo(new THREE.SphereGeometry(BALL_R, 22, 16))
  const ball = new THREE.Mesh(
    ballGeo,
    keep.mat(
      new THREE.MeshStandardMaterial({ color: 0xfdfdf6, roughness: 0.42, emissive: 0x2a2a22 }),
    ),
  )
  scene.add(ball)
  const trail: THREE.Mesh[] = []
  for (let i = 0; i < TRAIL; i++) {
    const m = new THREE.Mesh(
      ballGeo,
      keep.mat(
        new THREE.MeshBasicMaterial({
          color: 0xff8a5c,
          transparent: true,
          opacity: 0.3 * (1 - i / TRAIL),
          depthWrite: false,
        }),
      ),
    )
    m.visible = false
    m.scale.setScalar(1 - i * 0.13)
    scene.add(m)
    trail.push(m)
  }
  const history: THREE.Vector3[] = Array.from({ length: TRAIL }, () => new THREE.Vector3())

  const ringMat = keep.mat(
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  const ring = new THREE.Mesh(
    keep.geo(new THREE.RingGeometry(BALL_R * 1.9, BALL_R * 2.5, 32)),
    ringMat,
  )
  ring.visible = false
  scene.add(ring)

  return {
    p1Paddle,
    p2Paddle,
    p1Mascot,
    p2Mascot,
    ball,
    ballShadow,
    p1Shadow,
    p2Shadow,
    trail,
    history,
    ring,
    ringMat,
  }
}
