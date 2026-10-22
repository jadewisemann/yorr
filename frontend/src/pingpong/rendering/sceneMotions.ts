/**
 * 장면의 매 프레임 갱신 — 공·그림자·선수·잔상·카메라. `Stage`의 물체를 받아
 * 값만 바꾼다(만드는 일은 [`sceneStage.ts`](./sceneStage.ts)).
 */
import type * as THREE from 'three'
import {
  BALL_R,
  ballY,
  flightProgress,
  posToZ,
  TABLE_H,
  TABLE_LEN,
  TABLE_W,
  xToWorld,
} from '@/pingpong/domain/court'
import type { FrameState } from '@/pingpong/domain/frameState'
import { clamp } from './sceneMath'
import { poseMascot, posePaddle } from './scenePuppets'
import type { Stage } from './sceneStage'

const SHAKE_AMP = 0.05 // 스매시 화면 흔들림 (m)

export interface BallPoint {
  bx: number
  by: number
  bz: number
  overTop: boolean
}

/** 한 프레임의 물체 갱신. 순서가 곧 겹침 순서다(공 → 그림자 → 선수 → 잔상 → 카메라). */
export function updateStage(stage: Stage, s: FrameState) {
  const position = updateBall(stage, s)
  updateBallShadow(stage, position)
  updatePlayers(stage, s)
  updateTrail(stage, position, s)
  updateCameras(stage, s.shake)
}

function updateBall(stage: Stage, s: FrameState): BallPoint {
  const prog = flightProgress(s.ballPos, s.ballDir, s.ballFault)
  const bx = xToWorld(s.ballX)
  const bz = posToZ(s.ballPos)
  const overTop = Math.abs(bz) <= TABLE_LEN / 2 && Math.abs(bx) <= TABLE_W / 2
  const restY = (overTop ? TABLE_H : 0) + BALL_R
  const by = Math.max(
    restY,
    ballY(prog, s.ballSmash, s.ballFault, s.ballFaultFrom) - 4.9 * s.ballFall * s.ballFall,
  )
  stage.ball.position.set(bx, by, bz)
  stage.ball.rotation.x += s.ballDir * 0.42
  stage.ball.rotation.y += 0.12
  return { bx, by, bz, overTop }
}

function updateBallShadow(stage: Stage, { bx, by, bz, overTop }: BallPoint) {
  const groundY = overTop ? TABLE_H + 0.003 : 0.006
  const height = Math.max(0, by - groundY)
  stage.ballShadow.position.set(bx, groundY, bz)
  const spread = 0.13 + height * 0.42
  stage.ballShadow.scale.set(spread, spread, 1)
  const material = stage.ballShadow.material as THREE.MeshBasicMaterial
  material.opacity = clamp(0.9 - height * 0.75, 0.14, 0.9)
}

function updatePlayers(stage: Stage, s: FrameState) {
  posePaddle(stage.p1Paddle, s.p1X, s.p1Swing)
  posePaddle(stage.p2Paddle, s.p2X, s.p2Swing)

  const t = performance.now() / 1000
  const react = clamp(s.shake * (s.ballSmash ? 1 : 0.55), 0, 1)
  poseMascot(stage.p1Mascot, s.p1X, s.p1Swing, react, t)
  poseMascot(stage.p2Mascot, s.p2X, s.p2Swing, react, t)
  stage.p1Shadow.position.x = stage.p1Mascot.root.position.x
  stage.p2Shadow.position.x = stage.p2Mascot.root.position.x
}

function updateTrail(stage: Stage, { bx, by, bz }: BallPoint, s: FrameState) {
  shiftTrailHistory(stage)
  stage.history[0]?.set(bx, by, bz)
  renderTrail(stage, s.ballSmash && s.playing)
}

function shiftTrailHistory(stage: Stage) {
  for (let i = stage.history.length - 1; i > 0; i--) {
    const current = stage.history[i]
    const previous = stage.history[i - 1]
    if (current && previous) current.copy(previous)
  }
}

function renderTrail(stage: Stage, showTrail: boolean) {
  for (let i = 0; i < stage.trail.length; i++) {
    const dot = stage.trail[i]
    const point = stage.history[i]
    if (!dot) continue
    dot.visible = showTrail
    if (showTrail && point) dot.position.copy(point)
  }
}

function updateCameras(stage: Stage, shake: number) {
  for (const v of [1, 2] as const) {
    const home = stage.camHome[v]
    if (shake > 0) {
      stage.cams[v].position.set(
        home.x + (Math.random() - 0.5) * SHAKE_AMP * shake,
        home.y + (Math.random() - 0.5) * SHAKE_AMP * shake,
        home.z,
      )
    } else if (!stage.cams[v].position.equals(home)) {
      stage.cams[v].position.copy(home)
    }
  }
}
