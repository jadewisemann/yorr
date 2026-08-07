import * as THREE from 'three'
import {
  BALL_R,
  ballY,
  FAR_Z,
  flightProgress,
  IDEAL1,
  IDEAL2,
  NEAR_Z,
  NET_H,
  NET_OVERHANG,
  PERFECT_D,
  posToZ,
  TABLE_H,
  TABLE_LEN,
  TABLE_THICK,
  TABLE_W,
  viewerDepth,
  W1_HI,
  W1_LO,
  xToWorld,
} from '@/pingpong/domain/court'
import type { FrameState, Viewer } from '@/pingpong/domain/frameState'

const FOV = 46
const CAM_HEIGHT = TABLE_H + 1.04 // 눈높이
const CAM_BACK = 1.72 // 자기 코트 끝에서 뒤로 물러난 거리
const LOOK_HEIGHT = TABLE_H - 0.02
const LOOK_AHEAD = -0.3 // 시선이 향하는 z (자기 코트 기준 네트 너머)
const PADDLE_Y = TABLE_H + 0.15 // 라켓을 쥔 높이
const SHAKE_AMP = 0.05 // 스매시 화면 흔들림 (m)
const TRAIL = 5 // 스매시 잔상 개수

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeOut = (t: number) => 1 - (1 - t) * (1 - t)

function canvasTex(
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const c = cv.getContext('2d')
  if (!c) throw new Error('Canvas 2D context is unavailable')
  draw(c)
  const t = new THREE.CanvasTexture(cv)
  t.anisotropy = 4
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function tableTopTexture() {
  const W = 560
  const H = Math.round(W * (TABLE_LEN / TABLE_W))
  return canvasTex(W, H, (c) => {
    const g = c.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#1262a0')
    g.addColorStop(0.5, '#1a7cc4')
    g.addColorStop(1, '#1262a0')
    c.fillStyle = g
    c.fillRect(0, 0, W, H)
    c.globalAlpha = 0.05
    c.fillStyle = '#ffffff'
    for (let x = 0; x < W; x += 7) c.fillRect(x, 0, 1, H)
    c.globalAlpha = 1
    const line = Math.max(3, Math.round(W * 0.016))
    c.strokeStyle = '#f4f8fb'
    c.lineWidth = line
    c.strokeRect(line / 2, line / 2, W - line, H - line)
    c.fillStyle = 'rgba(244,248,251,0.9)'
    c.fillRect(W / 2 - line * 0.22, 0, line * 0.44, H)
    c.fillStyle = 'rgba(0,0,0,0.16)'
    c.fillRect(0, H / 2 - 3, W, 6)
  })
}

function netTexture() {
  return canvasTex(512, 96, (c) => {
    c.clearRect(0, 0, 512, 96)
    c.strokeStyle = 'rgba(240,246,255,0.62)'
    c.lineWidth = 1.4
    for (let x = 0; x <= 512; x += 9) {
      c.beginPath()
      c.moveTo(x, 14)
      c.lineTo(x, 96)
      c.stroke()
    }
    for (let y = 14; y <= 96; y += 9) {
      c.beginPath()
      c.moveTo(0, y)
      c.lineTo(512, y)
      c.stroke()
    }
    c.fillStyle = '#f2f6fb'
    c.fillRect(0, 0, 512, 13)
  })
}

function blobTexture() {
  return canvasTex(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(0,0,0,0.85)')
    g.addColorStop(0.45, 'rgba(0,0,0,0.42)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 128, 128)
  })
}

function wallTexture() {
  return canvasTex(64, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, '#05080e')
    g.addColorStop(0.55, '#0b131f')
    g.addColorStop(0.86, '#16243a')
    g.addColorStop(1, '#1d2f49')
    c.fillStyle = g
    c.fillRect(0, 0, 64, 256)
    c.fillStyle = 'rgba(120,160,210,0.16)'
    c.fillRect(0, 248, 64, 3)
  })
}

function floorTexture() {
  return canvasTex(512, 512, (c) => {
    c.fillStyle = '#0a0f18'
    c.fillRect(0, 0, 512, 512)
    const g = c.createRadialGradient(256, 256, 20, 256, 256, 250)
    g.addColorStop(0, 'rgba(90,130,180,0.30)')
    g.addColorStop(0.55, 'rgba(50,80,120,0.12)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 512, 512)
    c.strokeStyle = 'rgba(255,255,255,0.035)'
    c.lineWidth = 1
    for (let i = 0; i <= 512; i += 32) {
      c.beginPath()
      c.moveTo(i, 0)
      c.lineTo(i, 512)
      c.stroke()
      c.beginPath()
      c.moveTo(0, i)
      c.lineTo(512, i)
      c.stroke()
    }
  })
}

interface Paddle {
  group: THREE.Group
  facing: -1 | 1
  baseZ: number
}

function makePaddle(color: number, facing: -1 | 1, baseZ: number, mats: MatBag): Paddle {
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

function poseP(p: Paddle, xNorm: number, swing: number) {
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

const FUR = 0xf4ce5e // 버터
const BELLY = 0xfbe7a8
const NOSE = 0x6b4a2b
const CHEEK = 0xf0a98c
const EYE = 0x241c14

const MASCOT_SCALE = 0.8
const MASCOT_BACK = 0.66

const WRIST_X = 1.0 // 손목 — 팔보다 라켓을 세워 쥔다
const ARM_REST_X = -1.0
const ARM_REST_Z = 0
const ARM_HIT_X = -2.1
const ARM_HIT_Y = 0.1
const ARM_HIT_Z = 0.85

interface Mascot {
  root: THREE.Group
  body: THREE.Group
  arm: THREE.Group
  ears: THREE.Group[]
  facing: -1 | 1
}

function makeMascot(accentColor: number, z: number, facing: -1 | 1, mats: MatBag): Mascot {
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

function poseMascot(m: Mascot, xNorm: number, swing: number, react: number, t: number) {
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

interface MatBag {
  rubber(color: number): THREE.Material
  accent(color: number): THREE.Material
  wood: THREE.Material
  fur: THREE.Material
  belly: THREE.Material
  nose: THREE.Material
  cheek: THREE.Material
  eye: THREE.Material
  glint: THREE.Material
  geo<T extends THREE.BufferGeometry>(g: T): T
}

export interface PingPongScene {
  update(s: FrameState): void
  render(s: FrameState): void
  resize(w: number, h: number, dpr: number): void
  dispose(): void
}

const CANVAS_COLOR = 0x070b12

export function createScene(canvas: HTMLCanvasElement): PingPongScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setClearColor(CANVAS_COLOR, 1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(CANVAS_COLOR, 0.085)

  const geos: THREE.BufferGeometry[] = []
  const matsList: THREE.Material[] = []
  const texs: THREE.Texture[] = []
  const keepG = <T extends THREE.BufferGeometry>(g: T) => {
    geos.push(g)
    return g
  }
  const keepM = <T extends THREE.Material>(m: T) => {
    matsList.push(m)
    return m
  }
  const keepT = <T extends THREE.Texture>(t: T) => {
    texs.push(t)
    return t
  }

  const texTable = keepT(tableTopTexture())
  const texNet = keepT(netTexture())
  const texBlob = keepT(blobTexture())
  const texFloor = keepT(floorTexture())
  texFloor.wrapS = texFloor.wrapT = THREE.RepeatWrapping
  texFloor.repeat.set(3, 3)

  const mats: MatBag = {
    rubber: (color) =>
      keepM(new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02 })),
    accent: (color) => keepM(new THREE.MeshStandardMaterial({ color, roughness: 0.6 })),
    wood: keepM(new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 0.68 })),
    fur: keepM(new THREE.MeshStandardMaterial({ color: FUR, roughness: 0.78 })),
    belly: keepM(new THREE.MeshStandardMaterial({ color: BELLY, roughness: 0.82 })),
    nose: keepM(new THREE.MeshStandardMaterial({ color: NOSE, roughness: 0.5 })),
    cheek: keepM(new THREE.MeshStandardMaterial({ color: CHEEK, roughness: 0.85 })),
    eye: keepM(new THREE.MeshStandardMaterial({ color: EYE, roughness: 0.35 })),
    glint: keepM(new THREE.MeshStandardMaterial({ color: 0xfdfdf6, roughness: 0.4 })),
    geo: keepG,
  }

  scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x0d141f, 0.62))
  const key = new THREE.DirectionalLight(0xffffff, 1.85)
  key.position.set(1.1, 3.4, 1.5)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6ea8ff, 0.42)
  rim.position.set(-1.6, 1.4, -2.4)
  scene.add(rim)

  const floor = new THREE.Mesh(
    keepG(new THREE.PlaneGeometry(26, 26)),
    keepM(new THREE.MeshStandardMaterial({ map: texFloor, roughness: 0.94 })),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const texWall = keepT(wallTexture())
  const wallGeo = keepG(new THREE.PlaneGeometry(18, 7))
  const wallMat = keepM(new THREE.MeshBasicMaterial({ map: texWall, fog: true }))
  for (const sz of [-1, 1] as const) {
    const wall = new THREE.Mesh(wallGeo, wallMat)
    wall.position.set(0, 3.5, sz * 7)
    if (sz > 0) wall.rotation.y = Math.PI // 안쪽을 보게
    scene.add(wall)
  }

  const topSide = keepM(new THREE.MeshStandardMaterial({ color: 0x0d3f66, roughness: 0.6 }))
  const topFace = keepM(
    new THREE.MeshStandardMaterial({ map: texTable, roughness: 0.34, metalness: 0.04 }),
  )
  const tableTop = new THREE.Mesh(keepG(new THREE.BoxGeometry(TABLE_W, TABLE_THICK, TABLE_LEN)), [
    topSide,
    topSide,
    topFace,
    topSide,
    topSide,
    topSide,
  ])
  tableTop.position.y = TABLE_H - TABLE_THICK / 2
  scene.add(tableTop)

  const legMat = keepM(
    new THREE.MeshStandardMaterial({ color: 0x161c27, roughness: 0.7, metalness: 0.25 }),
  )
  const legGeo = keepG(new THREE.BoxGeometry(0.06, TABLE_H - TABLE_THICK, 0.06))
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, legMat)
      leg.position.set(
        sx * (TABLE_W / 2 - 0.13),
        (TABLE_H - TABLE_THICK) / 2,
        sz * (TABLE_LEN / 2 - 0.2),
      )
      scene.add(leg)
    }
  const beamGeo = keepG(new THREE.BoxGeometry(TABLE_W - 0.3, 0.04, 0.04))
  for (const sz of [-1, 1]) {
    const beam = new THREE.Mesh(beamGeo, legMat)
    beam.position.set(0, 0.36, sz * (TABLE_LEN / 2 - 0.2))
    scene.add(beam)
  }

  const netW = TABLE_W + NET_OVERHANG * 2
  const net = new THREE.Mesh(
    keepG(new THREE.PlaneGeometry(netW, NET_H)),
    keepM(
      new THREE.MeshBasicMaterial({
        map: texNet,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  )
  net.position.set(0, TABLE_H + NET_H / 2, 0)
  scene.add(net)
  const postGeo = keepG(new THREE.CylinderGeometry(0.012, 0.012, NET_H + 0.03, 10))
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, legMat)
    post.position.set((sx * netW) / 2, TABLE_H + (NET_H + 0.03) / 2, 0)
    scene.add(post)
  }

  const P1_COLOR = 0x2b8fe0 // 가까운쪽(P1) 파랑 — 기존 2D 색 유지
  const P2_COLOR = 0xe2513c // 먼쪽(P2) 빨강
  const p1Paddle = makePaddle(P1_COLOR, -1, posToZ(IDEAL1), mats)
  const p2Paddle = makePaddle(P2_COLOR, 1, posToZ(IDEAL2), mats)
  scene.add(p1Paddle.group, p2Paddle.group)
  const p1Mascot = makeMascot(P1_COLOR, NEAR_Z + MASCOT_BACK, -1, mats)
  const p2Mascot = makeMascot(P2_COLOR, FAR_Z - MASCOT_BACK, 1, mats)
  scene.add(p1Mascot.root, p2Mascot.root)

  const blobGeo = keepG(new THREE.PlaneGeometry(1, 1))
  const mkBlob = (opacity: number) => {
    const m = new THREE.Mesh(
      blobGeo,
      keepM(
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

  const ballGeo = keepG(new THREE.SphereGeometry(BALL_R, 22, 16))
  const ball = new THREE.Mesh(
    ballGeo,
    keepM(new THREE.MeshStandardMaterial({ color: 0xfdfdf6, roughness: 0.42, emissive: 0x2a2a22 })),
  )
  scene.add(ball)
  const trail: THREE.Mesh[] = []
  for (let i = 0; i < TRAIL; i++) {
    const m = new THREE.Mesh(
      ballGeo,
      keepM(
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

  const ringMat = keepM(
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  const ring = new THREE.Mesh(
    keepG(new THREE.RingGeometry(BALL_R * 1.9, BALL_R * 2.5, 32)),
    ringMat,
  )
  ring.visible = false
  scene.add(ring)

  const mkCam = (viewer: Viewer) => {
    const c = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60)
    const sign = viewer === 1 ? 1 : -1
    c.position.set(0, CAM_HEIGHT, sign * (TABLE_LEN / 2 + CAM_BACK))
    c.lookAt(0, LOOK_HEIGHT, sign * LOOK_AHEAD)
    return c
  }
  const cams: Record<Viewer, THREE.PerspectiveCamera> = { 1: mkCam(1), 2: mkCam(2) }
  const camHome: Record<Viewer, THREE.Vector3> = {
    1: cams[1].position.clone(),
    2: cams[2].position.clone(),
  }

  let vw = 1
  let vh = 1

  function update(s: FrameState) {
    const position = updateBall(s)
    updateBallShadow(position)
    updatePlayers(s)
    updateTrail(position, s)
    updateCameras(s.shake)
  }

  function updateBall(s: FrameState) {
    const prog = flightProgress(s.ballPos, s.ballDir, s.ballFault)
    const bx = xToWorld(s.ballX)
    const bz = posToZ(s.ballPos)
    const overTop = Math.abs(bz) <= TABLE_LEN / 2 && Math.abs(bx) <= TABLE_W / 2
    const restY = (overTop ? TABLE_H : 0) + BALL_R
    const by = Math.max(
      restY,
      ballY(prog, s.ballSmash, s.ballFault, s.ballFaultFrom) - 4.9 * s.ballFall * s.ballFall,
    )
    ball.position.set(bx, by, bz)
    ball.rotation.x += s.ballDir * 0.42
    ball.rotation.y += 0.12

    return { bx, by, bz, overTop }
  }

  function updateBallShadow({
    bx,
    by,
    bz,
    overTop,
  }: {
    bx: number
    by: number
    bz: number
    overTop: boolean
  }) {
    const groundY = overTop ? TABLE_H + 0.003 : 0.006
    const height = Math.max(0, by - groundY)
    ballShadow.position.set(bx, groundY, bz)
    const spread = 0.13 + height * 0.42
    ballShadow.scale.set(spread, spread, 1)
    const sm = ballShadow.material as THREE.MeshBasicMaterial
    sm.opacity = clamp(0.9 - height * 0.75, 0.14, 0.9)
  }

  function updatePlayers(s: FrameState) {
    poseP(p1Paddle, s.p1X, s.p1Swing)
    poseP(p2Paddle, s.p2X, s.p2Swing)

    const t = performance.now() / 1000
    const react = clamp(s.shake * (s.ballSmash ? 1 : 0.55), 0, 1)
    poseMascot(p1Mascot, s.p1X, s.p1Swing, react, t)
    poseMascot(p2Mascot, s.p2X, s.p2Swing, react, t)
    p1Shadow.position.x = p1Mascot.root.position.x
    p2Shadow.position.x = p2Mascot.root.position.x
  }

  function updateTrail({ bx, by, bz }: { bx: number; by: number; bz: number }, s: FrameState) {
    shiftTrailHistory()
    history[0]?.set(bx, by, bz)
    renderTrail(s.ballSmash && s.playing)
  }

  function shiftTrailHistory() {
    for (let i = history.length - 1; i > 0; i--) {
      const current = history[i]
      const previous = history[i - 1]
      if (current && previous) current.copy(previous)
    }
  }

  function renderTrail(showTrail: boolean) {
    for (let i = 0; i < trail.length; i++) {
      const dot = trail[i]
      const point = history[i]
      if (!dot) continue
      dot.visible = showTrail
      if (showTrail && point) dot.position.copy(point)
    }
  }

  function updateCameras(shake: number) {
    for (const v of [1, 2] as Viewer[]) {
      const home = camHome[v]
      if (shake > 0) {
        cams[v].position.set(
          home.x + (Math.random() - 0.5) * SHAKE_AMP * shake,
          home.y + (Math.random() - 0.5) * SHAKE_AMP * shake,
          home.z,
        )
      } else if (!cams[v].position.equals(home)) {
        cams[v].position.copy(home)
      }
    }
  }

  function prepare(viewer: Viewer, s: FrameState) {
    prepareViewer(viewer)
    prepareTimingRing(viewer, s)
  }

  function prepareViewer(viewer: Viewer) {
    p1Mascot.root.visible = viewer !== 1
    p2Mascot.root.visible = viewer !== 2
    p1Shadow.visible = viewer !== 1
    p2Shadow.visible = viewer !== 2
    p1Paddle.group.visible = viewer === 1
    p2Paddle.group.visible = viewer === 2
  }

  function prepareTimingRing(viewer: Viewer, s: FrameState) {
    const dv = viewerDepth(s.ballPos, viewer)
    const incoming = viewer === 1 ? s.ballDir > 0 : s.ballDir < 0
    const show = s.playing && incoming && !s.ballHit && !s.ballFault && dv > W1_LO - 0.14
    ring.visible = show
    if (!show) return

    const { color, opacity, scale } = timingRingStyle(dv)
    ringMat.color.setHex(color)
    ringMat.opacity = opacity
    ring.position.copy(ball.position)
    ring.quaternion.copy(cams[viewer].quaternion) // 카메라를 정면으로 바라보게
    ring.scale.setScalar(scale)
  }

  function timingRingStyle(depth: number) {
    const distance = Math.abs(depth - IDEAL1)
    if (distance <= PERFECT_D) return { color: 0xffd24a, opacity: 1, scale: 1.35 }
    if (depth >= W1_LO && depth <= W1_HI) return { color: 0x49e08a, opacity: 0.9, scale: 1 }
    return { color: 0xdfe6ec, opacity: 0.42, scale: 1 }
  }

  function render(s: FrameState) {
    if (s.split) {
      const halfW = Math.floor(vw / 2)
      renderer.setScissorTest(true)
      const passes: Array<[Viewer, number, number]> = [
        [1, 0, halfW],
        [2, halfW, vw - halfW],
      ]
      for (const [viewer, x, w] of passes) {
        const cam = cams[viewer]
        cam.aspect = w / vh
        cam.updateProjectionMatrix()
        renderer.setViewport(x, 0, w, vh)
        renderer.setScissor(x, 0, w, vh)
        prepare(viewer, s)
        renderer.render(scene, cam)
      }
      renderer.setScissorTest(false)
    } else {
      const cam = cams[s.viewer]
      cam.aspect = vw / vh
      cam.updateProjectionMatrix()
      renderer.setViewport(0, 0, vw, vh)
      prepare(s.viewer, s)
      renderer.render(scene, cam)
    }
  }

  function resize(w: number, h: number, dpr: number) {
    vw = Math.max(1, Math.round(w))
    vh = Math.max(1, Math.round(h))
    renderer.setPixelRatio(dpr)
    renderer.setSize(vw, vh, false)
  }

  function dispose() {
    geos.forEach((g) => {
      g.dispose()
    })
    matsList.forEach((m) => {
      m.dispose()
    })
    texs.forEach((t) => {
      t.dispose()
    })
    renderer.dispose()
  }

  return { update, render, resize, dispose }
}
