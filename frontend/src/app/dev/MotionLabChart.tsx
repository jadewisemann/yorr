import { type RefObject, useEffect, useRef } from 'react'
import type { LabChartSample } from './useMotionLab'

interface MotionLabChartProps {
  bufferRef: RefObject<LabChartSample[]>
  field: 'horizontal' | 'forward'
  label: string
  threshold: number
  releaseThreshold?: number
  symmetric?: boolean
}

const WINDOW_MS = 4_000
const HEIGHT = 110

/**
 * **원시값(`--ds-color-*`)을 읽는다. semantic(`--color-*`)을 읽으면 안 된다.**
 * `@theme inline`은 semantic 변수를 CSS에 **항상 내보내지 않는다** — 그 색이 어딘가에서
 * 알파 수식자와 함께 쓰일 때만(`bg-danger/20` 식) `--color-danger: var(--ds-color-danger)`가
 * 나온다. 수식자 없이만 쓰이는 색은 utility에 인라인되고 변수는 존재하지 않는다
 * (실측: `--color-danger`·`--color-brand`는 있고 `--color-canvas`·`--color-content`는 빈 값).
 * 즉 semantic 변수의 런타임 존재 여부는 **다른 파일의 `/20` 하나에 달려 있다** — 그것이
 * 사라지면 여기가 조용히 fallback으로 떨어진다. 원시값은 `:root`에 늘 있다.
 */
function cssColor(name: `--ds-color-${string}`, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

function resizeCanvas(canvas: HTMLCanvasElement, width: number, ratio: number) {
  const expectedWidth = width * ratio
  const expectedHeight = HEIGHT * ratio
  if (canvas.width === expectedWidth && canvas.height === expectedHeight) return
  canvas.width = expectedWidth
  canvas.height = expectedHeight
}

function drawGuide(
  context: CanvasRenderingContext2D,
  toY: (value: number) => number,
  value: number,
  color: string,
  symmetric: boolean,
) {
  context.strokeStyle = color
  context.setLineDash([5, 4])
  context.beginPath()
  context.moveTo(0, toY(value))
  context.lineTo(context.canvas.clientWidth, toY(value))
  if (symmetric) {
    context.moveTo(0, toY(-value))
    context.lineTo(context.canvas.clientWidth, toY(-value))
  }
  context.stroke()
  context.setLineDash([])
}

function drawWave(
  context: CanvasRenderingContext2D,
  buffer: LabChartSample[],
  field: MotionLabChartProps['field'],
  toX: (at: number) => number,
  toY: (value: number) => number,
  color: string,
) {
  if (buffer.length <= 1) return
  context.strokeStyle = color
  context.lineWidth = 2
  context.beginPath()
  buffer.forEach((entry, index) => {
    const point = [toX(entry.at), toY(entry[field])] as const
    if (index === 0) context.moveTo(...point)
    else context.lineTo(...point)
  })
  context.stroke()
}

export function MotionLabChart({
  bufferRef,
  field,
  label,
  threshold,
  releaseThreshold,
  symmetric = false,
}: MotionLabChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    // fallback도 디자인 시스템 값이다 — 예전 fallback(sky/amber 계열)은 팔레트에 없는
    // 색이라 변수가 빠지는 순간 차트만 다른 세상이 됐다.
    const waveColor = cssColor('--ds-color-brand', '#e53935')
    const thresholdColor = cssColor('--ds-color-danger', '#ff6b66')
    const releaseColor = cssColor('--ds-color-positive', '#8fcb9b')
    const gridColor = 'rgba(148, 163, 184, 0.35)'
    const textColor = cssColor('--ds-color-content-muted', '#a4a5aa')

    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      if (width === 0) return
      resizeCanvas(canvas, width, ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, HEIGHT)

      const buffer = bufferRef.current ?? []
      const latestAt = buffer.at(-1)?.at ?? 0
      const peak = buffer.reduce((max, entry) => Math.max(max, Math.abs(entry[field])), 0)
      const scale = Math.max(threshold * 1.4, peak * 1.1, 5)
      const midY = HEIGHT / 2
      const toY = (value: number) => midY - (value / scale) * (HEIGHT / 2 - 4)
      const toX = (at: number) => width - ((latestAt - at) / WINDOW_MS) * width

      context.strokeStyle = gridColor
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(0, midY)
      context.lineTo(width, midY)
      context.stroke()

      drawGuide(context, toY, threshold, thresholdColor, symmetric)
      if (releaseThreshold !== undefined) {
        drawGuide(context, toY, releaseThreshold, releaseColor, symmetric)
      }
      drawWave(context, buffer, field, toX, toY, waveColor)

      context.fillStyle = textColor
      context.font = '11px sans-serif'
      context.fillText(`±${scale.toFixed(1)} m/s²`, 6, 13)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [bufferRef, field, threshold, releaseThreshold, symmetric])

  return (
    <figure className="m-0 grid gap-1">
      <figcaption className="text-sm font-bold text-content">{label}</figcaption>
      <canvas
        ref={canvasRef}
        className="w-full rounded-card border border-border bg-surface-sunken"
        style={{ height: HEIGHT }}
        aria-label={`${label} 파형 차트`}
      />
    </figure>
  )
}
