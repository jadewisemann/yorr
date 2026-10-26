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
import { clamp } from './sceneMath'
import {
  MASCOT_BACK,
  MASCOT_COLORS,
  MASCOT_SHADOW_SCALE,
  type MatBag,
  makeMascot,
  makePaddle,
  poseMascot,
  posePaddle,
} from './scenePuppets'
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
const SHAKE_AMP = 0.05 // 스매시 화면 흔들림 (m)
const TRAIL = 5 // 스매시 잔상 개수

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
    fur: keepM(new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.fur, roughness: 0.78 })),
    belly: keepM(new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.belly, roughness: 0.82 })),
    nose: keepM(new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.nose, roughness: 0.5 })),
    cheek: keepM(new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.cheek, roughness: 0.85 })),
    eye: keepM(new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.eye, roughness: 0.35 })),
    glint: keepM(new THREE.MeshStandardMaterial({ color: MASCOT_COLORS.glint, roughness: 0.4 })),
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
  const mascotBlob = 0.9 * MASCOT_SHADOW_SCALE
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
    posePaddle(p1Paddle, s.p1X, s.p1Swing)
    posePaddle(p2Paddle, s.p2X, s.p2Swing)

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
