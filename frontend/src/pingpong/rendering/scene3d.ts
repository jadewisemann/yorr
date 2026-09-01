import * as THREE from 'three'
import {
  BALL_R,
  ballY,
  flightProgress,
  IDEAL1,
  PERFECT_D,
  posToZ,
  TABLE_H,
  TABLE_LEN,
  TABLE_W,
  viewerDepth,
  W1_HI,
  W1_LO,
  xToWorld,
} from '@/pingpong/domain/court'
import type { FrameState, Viewer } from '@/pingpong/domain/frameState'
import { buildActors } from './actors'
import { buildArena, type ResourceKeeper } from './arena'
import { poseMascot } from './mascot'
import { poseP } from './paddle'
import { clamp } from './sceneMath'
import { blobTexture } from './textures'

const FOV = 46
const CAM_HEIGHT = TABLE_H + 1.04 // 눈높이
const CAM_BACK = 1.72 // 자기 코트 끝에서 뒤로 물러난 거리
const LOOK_HEIGHT = TABLE_H - 0.02
const LOOK_AHEAD = -0.3 // 시선이 향하는 z (자기 코트 기준 네트 너머)
const SHAKE_AMP = 0.05 // 스매시 화면 흔들림 (m)
// 스매시 잔상 개수

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

  const keep: ResourceKeeper = { geo: keepG, mat: keepM, tex: keepT }
  const mats = buildArena(scene, keep)
  const texBlob = keepT(blobTexture())

  const {
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
  } = buildActors(scene, mats, keep, texBlob)

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
