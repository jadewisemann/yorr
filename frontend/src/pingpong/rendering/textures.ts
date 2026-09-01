import * as THREE from 'three'
import { TABLE_LEN, TABLE_W } from '@/pingpong/domain/court'

/**
 * 장면이 쓰는 텍스처는 전부 2D 캔버스에 그려서 만든다 — 이미지 파일을 두지 않는
 * 이유는 색과 선 굵기가 코트 치수(`domain/court.ts`)에서 파생되기 때문이다.
 */

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

export function tableTopTexture() {
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

export function netTexture() {
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

export function blobTexture() {
  return canvasTex(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(0,0,0,0.85)')
    g.addColorStop(0.45, 'rgba(0,0,0,0.42)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 128, 128)
  })
}

export function wallTexture() {
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

export function floorTexture() {
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
