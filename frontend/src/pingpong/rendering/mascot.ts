import * as THREE from 'three'
import { xToWorld } from '@/pingpong/domain/court'
import type { MatBag } from './materials'
import { clamp, easeOut, lerp } from './sceneMath'

export const MASCOT_SCALE = 0.8
export const MASCOT_BACK = 0.66

const WRIST_X = 1.0 // 손목 — 팔보다 라켓을 세워 쥔다
const ARM_REST_X = -1.0
const ARM_REST_Z = 0
const ARM_HIT_X = -2.1
const ARM_HIT_Y = 0.1
const ARM_HIT_Z = 0.85

export interface Mascot {
  root: THREE.Group
  body: THREE.Group
  arm: THREE.Group
  ears: THREE.Group[]
  facing: -1 | 1
}

export function makeMascot(accentColor: number, z: number, facing: -1 | 1, mats: MatBag): Mascot {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const g = mats.geo
  const accent = mats.accent(accentColor)

  const torso = new THREE.Mesh(g(new THREE.SphereGeometry(0.35, 20, 14)), mats.fur)
  torso.scale.set(1.06, 0.96, 0.98)
  torso.position.y = 0.7
  body.add(torso)

  const belly = new THREE.Mesh(g(new THREE.SphereGeometry(0.225, 16, 10)), mats.belly)
  belly.scale.set(0.94, 1, 0.48)
  belly.position.set(0, 0.66, 0.235)
  body.add(belly)

  const legGeo = g(new THREE.CapsuleGeometry(0.08, 0.16, 3, 8))
  const footGeo = g(new THREE.SphereGeometry(0.105, 10, 8))
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, mats.fur)
    leg.position.set(s * 0.145, 0.22, 0)
    body.add(leg)
    const foot = new THREE.Mesh(footGeo, mats.fur)
    foot.scale.set(1.1, 0.62, 1.45)
    foot.position.set(s * 0.145, 0.065, 0.05)
    body.add(foot)
  }

  const head = new THREE.Mesh(g(new THREE.SphereGeometry(0.36, 24, 16)), mats.fur)
  head.scale.set(1.02, 0.97, 0.99)
  head.position.y = 1.25
  body.add(head)

  const muzzle = new THREE.Mesh(g(new THREE.SphereGeometry(0.17, 16, 10)), mats.belly)
  muzzle.scale.set(1.15, 0.82, 0.7)
  muzzle.position.set(0, 1.15, 0.25)
  body.add(muzzle)

  const nose = new THREE.Mesh(g(new THREE.SphereGeometry(0.05, 10, 8)), mats.nose)
  nose.scale.set(1.25, 0.85, 0.85)
  nose.position.set(0, 1.17, 0.385)
  body.add(nose)

  const eyeGeo = g(new THREE.SphereGeometry(0.041, 10, 8))
  const glintGeo = g(new THREE.SphereGeometry(0.013, 6, 5))
  const cheekGeo = g(new THREE.SphereGeometry(0.085, 10, 8))
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, mats.eye)
    eye.position.set(s * 0.13, 1.27, 0.315)
    body.add(eye)
    const glint = new THREE.Mesh(glintGeo, mats.glint)
    glint.position.set(s * 0.12, 1.29, 0.35)
    body.add(glint)
    const cheek = new THREE.Mesh(cheekGeo, mats.cheek)
    cheek.scale.set(1, 0.85, 0.7)
    cheek.position.set(s * 0.22, 1.12, 0.255)
    body.add(cheek)
  }

  const earGeo = g(new THREE.SphereGeometry(0.105, 12, 8))
  const earInGeo = g(new THREE.SphereGeometry(0.057, 8, 6))
  const ears: THREE.Group[] = []
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(s * 0.2, 1.36, -0.01)
    body.add(pivot)
    const ear = new THREE.Mesh(earGeo, mats.fur)
    ear.scale.set(1, 1, 0.6)
    ear.position.set(s * 0.045, 0.13, 0)
    pivot.add(ear)
    const inner = new THREE.Mesh(earInGeo, mats.cheek)
    inner.scale.set(1, 1, 0.5)
    inner.position.set(s * 0.045, 0.125, 0.048)
    pivot.add(inner)
    ears.push(pivot)
  }

  const band = new THREE.Mesh(g(new THREE.TorusGeometry(0.325, 0.03, 6, 20)), accent)
  band.rotation.x = Math.PI / 2
  band.scale.set(1.02, 0.99, 1) // 회전 전 기준: y 가 앞뒤(깊이)
  band.position.y = 1.4
  body.add(band)

  const upperGeo = g(new THREE.CapsuleGeometry(0.075, 0.22, 3, 8))
  const pawGeo = g(new THREE.SphereGeometry(0.085, 10, 8))
  const cuffGeo = g(new THREE.TorusGeometry(0.075, 0.022, 5, 12))
  const mkArm = (side: -1 | 1) => {
    const a = new THREE.Group()
    a.position.set(side * 0.34, 1.0, 0.02)
    body.add(a)
    const upper = new THREE.Mesh(upperGeo, mats.fur)
    upper.position.y = -0.16
    a.add(upper)
    const paw = new THREE.Mesh(pawGeo, mats.fur)
    paw.position.y = -0.31
    a.add(paw)
    const cuff = new THREE.Mesh(cuffGeo, accent)
    cuff.rotation.x = Math.PI / 2
    cuff.position.y = -0.255
    a.add(cuff)
    return a
  }

  const leftArm = mkArm(-1)
  leftArm.rotation.set(-0.3, 0, -0.26)

  const arm = mkArm(1)
  arm.rotation.set(ARM_REST_X, 0, ARM_REST_Z)

  const grip = new THREE.Group()
  grip.position.set(0, -0.31, 0.02)
  grip.rotation.set(WRIST_X, 0, 0)
  arm.add(grip)
  const handle = new THREE.Mesh(g(new THREE.BoxGeometry(0.026, 0.095, 0.018)), mats.wood)
  handle.position.y = 0.045 // 주먹 안
  grip.add(handle)
  const blade = new THREE.Mesh(
    g(new THREE.CylinderGeometry(0.077, 0.077, 0.009, 20)),
    mats.rubber(accentColor),
  )
  blade.rotation.x = Math.PI / 2
  blade.position.y = 0.16
  grip.add(blade)
  const rim = new THREE.Mesh(g(new THREE.TorusGeometry(0.077, 0.0055, 5, 20)), mats.wood)
  rim.position.y = 0.16
  grip.add(rim)

  root.position.set(0, 0, z)
  root.rotation.y = facing < 0 ? Math.PI : 0 // 상대를 바라보게
  root.scale.setScalar(MASCOT_SCALE) // 덩치는 여기서 한 번에 (poseMascot 의 body.scale 과 안 겹친다)
  return { root, body, arm, ears, facing }
}

export function poseMascot(m: Mascot, xNorm: number, swing: number, react: number, t: number) {
  const x = xToWorld(lerp(0.5, xNorm, 0.55))
  m.root.position.x = x
  m.body.rotation.y = clamp(m.facing * (xToWorld(xNorm) - x) * 0.5, -0.3, 0.3)

  m.body.position.y = Math.sin(t * 2.1) * 0.018
  m.body.rotation.x = -0.16 * react
  m.body.scale.set(1 + 0.03 * react, 1 - 0.05 * react, 1 + 0.03 * react)

  const flick = Math.sin(t * 2.1 + 0.6) * 0.09 + react * 0.25
  const [leftEar, rightEar] = m.ears
  if (leftEar) leftEar.rotation.z = flick
  if (rightEar) rightEar.rotation.z = -flick

  const st = easeOut(1 - clamp(swing, 0, 1))
  m.arm.rotation.x = lerp(ARM_HIT_X, ARM_REST_X, st)
  m.arm.rotation.y = lerp(ARM_HIT_Y, 0, st)
  m.arm.rotation.z = lerp(ARM_HIT_Z, ARM_REST_Z, st)
}
