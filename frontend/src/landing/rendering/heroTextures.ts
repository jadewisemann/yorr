import * as THREE from 'three'
import { dsColorReader } from '@/styles/tokenFallbacks'

/**
 * 주사위 눈 텍스처와 매트 재질.
 *
 * 왜 분리했나: 캔버스 텍스처 굽기와 재질 파라미터는 씬 수명·애니메이션과 무관하고,
 * `heroScene.test`가 "눈 하나 = fill 한 번"을 세는 대상이기도 하다. 씬 코드와 섞여
 * 있으면 그 계약이 어디까지인지 읽기 어렵다.
 */

/** 히어로 씬의 고정 팔레트. 테마 토큰이 아니라 브랜드 색이다(디자인 시스템의 예외). */
export const HERO_PALETTE = {
  ivory: 0xf4f1e8,
  ink: 0x0b0b0c,
  accent: 0xe53935,
  slate: 0x24252a,
} as const

export type PipCount = 1 | 2 | 3 | 4 | 5 | 6

export const PIP_LAYOUT: Record<PipCount, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.26, 0.26],
    [0.5, 0.5],
    [0.74, 0.74],
  ],
  4: [
    [0.29, 0.29],
    [0.71, 0.29],
    [0.29, 0.71],
    [0.71, 0.71],
  ],
  5: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.5, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  6: [
    [0.29, 0.24],
    [0.71, 0.24],
    [0.29, 0.5],
    [0.71, 0.5],
    [0.29, 0.76],
    [0.71, 0.76],
  ],
}

export const FACE_ORDER: PipCount[] = [1, 6, 2, 5, 3, 4]

export interface SpinBob {
  bob?: number
  spin?: number
}

/**
 * 면 하나의 텍스처. 민짜 단색이면 조명이 아무리 좋아도 면이 종이처럼 읽혀서,
 * 위가 살짝 밝은 세로 그라디언트(면의 방향감)와 가장자리 비네팅(모서리로 말려
 * 들어가는 느낌), 눈의 안쪽 그림자(파인 홈)를 겹친다. 눈 하나 = fill 한 번의
 * 계약은 유지한다(heroScene.test가 21회를 센다) — 셰이딩은 전부 fillRect와
 * 그라디언트 fillStyle로만 얹는다.
 */
export function pipTexture(pips: PipCount) {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('주사위 텍스처를 그릴 수 없습니다.')
  const color = dsColorReader()
  context.fillStyle = color('--ds-color-physics-die')
  context.fillRect(0, 0, size, size)

  const sheen = context.createLinearGradient(0, 0, 0, size)
  sheen.addColorStop(0, 'rgb(255 255 255 / 45%)')
  sheen.addColorStop(0.45, 'rgb(255 255 255 / 0%)')
  context.fillStyle = sheen
  context.fillRect(0, 0, size, size)

  const vignette = context.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.3,
    size / 2,
    size / 2,
    size * 0.72,
  )
  vignette.addColorStop(0, 'rgb(0 0 0 / 0%)')
  vignette.addColorStop(1, 'rgb(0 0 0 / 14%)')
  context.fillStyle = vignette
  context.fillRect(0, 0, size, size)

  const pipRadius = size * 0.075
  for (const [x, y] of PIP_LAYOUT[pips]) {
    const pip = context.createRadialGradient(
      x * size - pipRadius * 0.3,
      y * size - pipRadius * 0.3,
      pipRadius * 0.15,
      x * size,
      y * size,
      pipRadius,
    )
    pip.addColorStop(0, color('--ds-color-physics-pip'))
    pip.addColorStop(0.8, color('--ds-color-physics-pip'))
    pip.addColorStop(1, 'rgb(0 0 0 / 45%)')
    context.fillStyle = pip
    context.beginPath()
    context.arc(x * size, y * size, pipRadius, 0, Math.PI * 2)
    context.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/**
 * 매트 표면 하나로 통일한다 — metalness 0(환경맵이 없어 금속은 검게 죽는다),
 * roughness는 재질감만 가른다. 예전 Lambert의 플라스틱 같은 명암 단절이
 * Standard의 완만한 falloff로 바뀌는 것이 이 함수의 존재 이유다.
 */
export function matte(color: number, options: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.55, ...options })
}
