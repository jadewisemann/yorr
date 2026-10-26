import * as THREE from 'three'
import { IDEAL1, PERFECT_D, viewerDepth, W1_HI, W1_LO } from '@/pingpong/domain/court'
import type { FrameState, Viewer } from '@/pingpong/domain/frameState'
import { updateStage } from './sceneMotions'
import { buildStage, CANVAS_COLOR, type Stage } from './sceneStage'

export interface PingPongScene {
  update(s: FrameState): void
  render(s: FrameState): void
  resize(w: number, h: number, dpr: number): void
  dispose(): void
}

/**
 * 탁구 3D 화면. 만드는 일은 [`sceneStage`](./sceneStage.ts), 매 프레임 갱신은
 * [`sceneMotions`](./sceneMotions.ts)에 있고, 여기서는 렌더러·뷰포트·분할 화면만 다룬다.
 */
export function createScene(canvas: HTMLCanvasElement): PingPongScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setClearColor(CANVAS_COLOR, 1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12

  const stage = buildStage()
  const viewport = { width: 1, height: 1 }
  const frame = { renderer, stage, viewport }

  return {
    update: (s) => updateStage(stage, s),
    render: (s) => renderFrame(frame, s),
    resize: (w, h, dpr) => {
      viewport.width = Math.max(1, Math.round(w))
      viewport.height = Math.max(1, Math.round(h))
      renderer.setPixelRatio(dpr)
      renderer.setSize(viewport.width, viewport.height, false)
    },
    dispose: () => {
      stage.dispose()
      renderer.dispose()
    },
  }
}

/** 씬 하나를 그리는 데 필요한 것 — 함수 인자를 줄이려고 묶었다. */
interface Frame {
  renderer: THREE.WebGLRenderer
  stage: Stage
  viewport: { width: number; height: number }
}

/** 분할 화면이면 뷰어마다 절반씩, 아니면 현재 뷰어의 카메라 하나로 그린다. */
function renderFrame({ renderer, stage, viewport }: Frame, s: FrameState) {
  const vw = viewport.width
  const vh = viewport.height
  if (s.split) {
    renderSplit({ renderer, stage, viewport }, s)
    return
  }
  const cam = stage.cams[s.viewer]
  cam.aspect = vw / vh
  cam.updateProjectionMatrix()
  renderer.setViewport(0, 0, vw, vh)
  prepareViewer(stage, s.viewer, s)
  renderer.render(stage.scene, cam)
}

function renderSplit({ renderer, stage, viewport }: Frame, s: FrameState) {
  const { width: vw, height: vh } = viewport
  const halfW = Math.floor(vw / 2)
  renderer.setScissorTest(true)
  const passes: Array<[Viewer, number, number]> = [
    [1, 0, halfW],
    [2, halfW, vw - halfW],
  ]
  for (const [viewer, x, w] of passes) {
    const cam = stage.cams[viewer]
    cam.aspect = w / vh
    cam.updateProjectionMatrix()
    renderer.setViewport(x, 0, w, vh)
    renderer.setScissor(x, 0, w, vh)
    prepareViewer(stage, viewer, s)
    renderer.render(stage.scene, cam)
  }
  renderer.setScissorTest(false)
}

/** 뷰어 자신은 마스코트·그림자를 감추고 자기 라켓만 보여 준다(1인칭). */
function prepareViewer(stage: Stage, viewer: Viewer, s: FrameState) {
  stage.p1Mascot.root.visible = viewer !== 1
  stage.p2Mascot.root.visible = viewer !== 2
  stage.p1Shadow.visible = viewer !== 1
  stage.p2Shadow.visible = viewer !== 2
  stage.p1Paddle.group.visible = viewer === 1
  stage.p2Paddle.group.visible = viewer === 2
  prepareTimingRing(stage, viewer, s)
}

/** 들어오는 공의 깊이를 맞출 타이밍 링. 판정 구간에 따라 색·크기가 바뀐다. */
function prepareTimingRing(stage: Stage, viewer: Viewer, s: FrameState) {
  const depth = viewerDepth(s.ballPos, viewer)
  const incoming = viewer === 1 ? s.ballDir > 0 : s.ballDir < 0
  const show = s.playing && incoming && !s.ballHit && !s.ballFault && depth > W1_LO - 0.14
  stage.ring.visible = show
  if (!show) return

  const { color, opacity, scale } = timingRingStyle(depth)
  stage.ringMat.color.setHex(color)
  stage.ringMat.opacity = opacity
  stage.ring.position.copy(stage.ball.position)
  stage.ring.quaternion.copy(stage.cams[viewer].quaternion) // 카메라를 정면으로 바라보게
  stage.ring.scale.setScalar(scale)
}

function timingRingStyle(depth: number) {
  const distance = Math.abs(depth - IDEAL1)
  if (distance <= PERFECT_D) return { color: 0xffd24a, opacity: 1, scale: 1.35 }
  if (depth >= W1_LO && depth <= W1_HI) return { color: 0x49e08a, opacity: 0.9, scale: 1 }
  return { color: 0xdfe6ec, opacity: 0.42, scale: 1 }
}
