/**
 * 3D 장면의 물체 — 조명·바닥·테이블·라켓·마스코트·공·잔상·카메라를 만들고,
 * 만든 자원을 한 곳에 모아 `dispose`가 빠뜨리지 않게 한다.
 *
 * 애니메이션(위치·자세 갱신)은 [`sceneMotions.ts`](./sceneMotions.ts)가 맡는다 —
 * 만드는 일과 움직이는 일을 가르면 씬 함수가 "무엇이 있는가"만 읽힌다.
 */
import * as THREE from 'three'
import {
  BALL_R,
  FAR_Z,
  IDEAL1,
  IDEAL2,
  NEAR_Z,
  posToZ,
  TABLE_H,
  TABLE_LEN,
} from '@/pingpong/domain/court'
import {
  MASCOT_BACK,
  MASCOT_COLORS,
  MASCOT_SHADOW_SCALE,
  type Mascot,
  type MatBag,
  makeMascot,
  makePaddle,
  type Paddle,
} from './scenePuppets'
import { buildTable } from './sceneTable'
import {
  blobTexture,
  floorTexture,
  netTexture,
  tableTopTexture,
  wallTexture,
} from './sceneTextures'

const FOV = 46
const CAM_HEIGHT = TABLE_H + 1.04 // 눈높이
const CAM_BACK = 1.72 // 자기 코트 끝에서 뒤로 물러난 거리
const LOOK_HEIGHT = TABLE_H - 0.02
const LOOK_AHEAD = -0.3 // 시선이 향하는 z (자기 코트 기준 네트 너머)
const TRAIL = 5 // 스매시 잔상 개수

export const CANVAS_COLOR = 0x070b12
export const CAMERA_ASPECT_MAX = 60

/** 씬이 들고 다니는 물체 묶음. 움직이는 함수들이 여기서 필요한 것만 꺼내 쓴다. */
export interface Stage {
  readonly scene: THREE.Scene
  readonly ball: THREE.Mesh
  readonly trail: readonly THREE.Mesh[]
  readonly history: readonly THREE.Vector3[]
  readonly ballShadow: THREE.Mesh
  readonly p1Shadow: THREE.Mesh
  readonly p2Shadow: THREE.Mesh
  readonly ring: THREE.Mesh
  readonly ringMat: THREE.MeshBasicMaterial
  readonly p1Paddle: Paddle
  readonly p2Paddle: Paddle
  readonly p1Mascot: Mascot
  readonly p2Mascot: Mascot
  readonly cams: Record<1 | 2, THREE.PerspectiveCamera>
  readonly camHome: Record<1 | 2, THREE.Vector3>
  dispose(): void
}

/** 장면을 만든다. 반환값은 물체 묶음과 자원 해제 함수다. */
export function buildStage(): Stage {
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(CANVAS_COLOR, 0.085)

  const resources = createResourceBag()
  const mats = buildMaterials(resources)
  addLights(scene)
  addFloor(scene, resources)
  addWalls(scene, resources)
  buildTable({
    scene,
    keepG: resources.geo,
    keepM: resources.mat,
    texTable: resources.tex(tableTopTexture()),
    texNet: resources.tex(netTexture()),
    legMat: resources.mat(
      new THREE.MeshStandardMaterial({ color: 0x161c27, roughness: 0.7, metalness: 0.25 }),
    ),
  })

  const players = addPlayers(scene, mats)
  const blob = addBlobs(scene, resources)
  const ballParts = addBall(scene, resources)
  const ring = addTimingRing(scene, resources)
  const cameras = buildCameras()

  return {
    scene,
    ball: ballParts.ball,
    trail: ballParts.trail,
    history: ballParts.history,
    ...blob,
    ...ring,
    ...players,
    cams: cameras.cams,
    camHome: cameras.camHome,
    dispose: resources.disposeAll,
  }
}

function createResourceBag() {
  const geos: THREE.BufferGeometry[] = []
  const matsList: THREE.Material[] = []
  const texs: THREE.Texture[] = []
  return {
    geo: <T extends THREE.BufferGeometry>(g: T) => {
      geos.push(g)
      return g
    },
    mat: <T extends THREE.Material>(m: T) => {
      matsList.push(m)
      return m
    },
    tex: <T extends THREE.Texture>(t: T) => {
      texs.push(t)
      return t
    },
    disposeAll: () => {
      for (const g of geos) g.dispose()
      for (const m of matsList) m.dispose()
      for (const t of texs) t.dispose()
    },
  }
}

function buildMaterials(resources: ReturnType<typeof createResourceBag>): MatBag {
  return {
    rubber: (color) =>
      resources.mat(new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02 })),
    accent: (color) => resources.mat(new THREE.MeshStandardMaterial({ color, roughness: 0.6 })),
    wood: resources.mat(new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 0.68 })),
    fur: resources.mat(
      new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.fur, roughness: 0.78 }),
    ),
    belly: resources.mat(
      new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.belly, roughness: 0.82 }),
    ),
    nose: resources.mat(
      new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.nose, roughness: 0.5 }),
    ),
    cheek: resources.mat(
      new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.cheek, roughness: 0.85 }),
    ),
    eye: resources.mat(
      new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.eye, roughness: 0.35 }),
    ),
    glint: resources.mat(
      new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.glint, roughness: 0.4 }),
    ),
    geo: resources.geo,
  }
}

function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x0d141f, 0.62))
  const key = new THREE.DirectionalLight(0xffffff, 1.85)
  key.position.set(1.1, 3.4, 1.5)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6ea8ff, 0.42)
  rim.position.set(-1.6, 1.4, -2.4)
  scene.add(rim)
}

function addFloor(scene: THREE.Scene, resources: ReturnType<typeof createResourceBag>) {
  const texFloor = resources.tex(floorTexture())
  texFloor.wrapS = texFloor.wrapT = THREE.RepeatWrapping
  texFloor.repeat.set(3, 3)
  const floor = new THREE.Mesh(
    resources.geo(new THREE.PlaneGeometry(26, 26)),
    resources.mat(new THREE.MeshStandardMaterial({ map: texFloor, roughness: 0.94 })),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)
}

function addWalls(scene: THREE.Scene, resources: ReturnType<typeof createResourceBag>) {
  const wallGeo = resources.geo(new THREE.PlaneGeometry(18, 7))
  const wallMat = resources.mat(new THREE.MeshBasicMaterial({ map: wallTexture(), fog: true }))
  for (const sz of [-1, 1] as const) {
    const wall = new THREE.Mesh(wallGeo, wallMat)
    wall.position.set(0, 3.5, sz * 7)
    if (sz > 0) wall.rotation.y = Math.PI // 안쪽을 보게
    scene.add(wall)
  }
}

const P1_COLOR = 0x2b8fe0 // 가까운쪽(P1) 파랑 — 기존 2D 색 유지
const P2_COLOR = 0xe2513c // 먼쪽(P2) 빨강

function addPlayers(scene: THREE.Scene, mats: MatBag) {
  const p1Paddle = makePaddle(P1_COLOR, -1, posToZ(IDEAL1), mats)
  const p2Paddle = makePaddle(P2_COLOR, 1, posToZ(IDEAL2), mats)
  scene.add(p1Paddle.group, p2Paddle.group)
  const p1Mascot = makeMascot(P1_COLOR, NEAR_Z + MASCOT_BACK, -1, mats)
  const p2Mascot = makeMascot(P2_COLOR, FAR_Z - MASCOT_BACK, 1, mats)
  scene.add(p1Mascot.root, p2Mascot.root)
  return { p1Paddle, p2Paddle, p1Mascot, p2Mascot }
}

function addBlobs(scene: THREE.Scene, resources: ReturnType<typeof createResourceBag>) {
  const blobGeo = resources.geo(new THREE.PlaneGeometry(1, 1))
  const texBlob = resources.tex(blobTexture())
  const mkBlob = (opacity: number) => {
    const m = new THREE.Mesh(
      blobGeo,
      resources.mat(
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
  const mascotBlob = 0.9 * MASCOT_SHADOW_SCALE
  p1Shadow.scale.set(mascotBlob, mascotBlob, 1)
  p1Shadow.position.set(0, 0.004, NEAR_Z + MASCOT_BACK)
  p2Shadow.scale.set(mascotBlob, mascotBlob, 1)
  p2Shadow.position.set(0, 0.004, FAR_Z - MASCOT_BACK)
  return { ballShadow, p1Shadow, p2Shadow }
}

function addBall(scene: THREE.Scene, resources: ReturnType<typeof createResourceBag>) {
  const ballGeo = resources.geo(new THREE.SphereGeometry(BALL_R, 22, 16))
  const ball = new THREE.Mesh(
    ballGeo,
    resources.mat(
      new THREE.MeshStandardMaterial({ color: 0xfdfdf6, roughness: 0.42, emissive: 0x2a2a22 }),
    ),
  )
  scene.add(ball)
  const trail: THREE.Mesh[] = []
  for (let i = 0; i < TRAIL; i++) {
    const m = new THREE.Mesh(
      ballGeo,
      resources.mat(
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
  const history = Array.from({ length: TRAIL }, () => new THREE.Vector3())
  return { ball, trail, history }
}

function addTimingRing(scene: THREE.Scene, resources: ReturnType<typeof createResourceBag>) {
  const ringMat = resources.mat(
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  const ring = new THREE.Mesh(
    resources.geo(new THREE.RingGeometry(BALL_R * 1.9, BALL_R * 2.5, 32)),
    ringMat,
  )
  ring.visible = false
  scene.add(ring)
  return { ring, ringMat }
}

function buildCameras() {
  const mkCam = (viewer: 1 | 2) => {
    const c = new THREE.PerspectiveCamera(FOV, 1, 0.05, CAMERA_ASPECT_MAX)
    const sign = viewer === 1 ? 1 : -1
    c.position.set(0, CAM_HEIGHT, sign * (TABLE_LEN / 2 + CAM_BACK))
    c.lookAt(0, LOOK_HEIGHT, sign * LOOK_AHEAD)
    return c
  }
  const cams: Record<1 | 2, THREE.PerspectiveCamera> = { 1: mkCam(1), 2: mkCam(2) }
  return {
    cams,
    camHome: { 1: cams[1].position.clone(), 2: cams[2].position.clone() },
  }
}
